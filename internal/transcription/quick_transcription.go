package transcription

import (
	"context"
	"fmt"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"io"
	"os"
	"path/filepath"
	"scriberr/internal/config"
	"scriberr/internal/database"
	"scriberr/internal/models"
	"scriberr/internal/repository"
	"scriberr/pkg/logger"
	"strings"
	"time"
)

type QuickTranscriptionJob struct {
	OwnerID      uint                  `json:"-"`
	ID           string                `json:"id"`
	Filename     string                `json:"filename"`
	Status       models.JobStatus      `json:"status"`
	Transcript   *string               `json:"transcript,omitempty"`
	Parameters   models.WhisperXParams `json:"parameters"`
	CreatedAt    time.Time             `json:"created_at"`
	ExpiresAt    time.Time             `json:"expires_at"`
	ErrorMessage *string               `json:"error_message,omitempty"`
}
type QuickTranscriptionService struct {
	config  *config.Config
	jobRepo repository.JobRepository
	enqueue func(string) error
	tempDir string
	stop    chan struct{}
}

func NewQuickTranscriptionService(cfg *config.Config, _ *UnifiedJobProcessor, repo repository.JobRepository) (*QuickTranscriptionService, error) {
	dir := filepath.Join(cfg.UploadDir, "quick_transcriptions")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	q := &QuickTranscriptionService{config: cfg, jobRepo: repo, tempDir: dir, stop: make(chan struct{})}
	// Migrate identifiable legacy temporary rows without touching library recordings.
	var old []models.TranscriptionJob
	if database.DB != nil {
		database.DB.Unscoped().Where("audio_path LIKE ? AND is_quick = ?", dir+string(os.PathSeparator)+"%", false).Find(&old)
		for _, j := range old {
			expires := j.CreatedAt.Add(6 * time.Hour)
			database.DB.Unscoped().Model(&j).Updates(map[string]interface{}{"is_quick": true, "expires_at": expires})
		}
	}
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if err := q.cleanupOneFile(time.Now()); err != nil {
					logger.Warn("Quick cleanup failed; will retry", "error", err)
				}
			case <-q.stop:
				return
			}
		}
	}()
	return q, nil
}
func (q *QuickTranscriptionService) SetEnqueue(f func(string) error) { q.enqueue = f }
func (q *QuickTranscriptionService) Close()                          { close(q.stop) }
func (q *QuickTranscriptionService) SubmitQuickJob(data io.Reader, filename string, params models.WhisperXParams, owners ...uint) (*QuickTranscriptionJob, error) {
	if q.enqueue == nil {
		return nil, fmt.Errorf("transcription queue unavailable")
	}
	id := uuid.NewString()
	path := filepath.Join(q.tempDir, id+filepath.Ext(filename))
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	size, err := io.Copy(f, data)
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(path)
		return nil, err
	}
	now := time.Now()
	expiry := now.Add(6 * time.Hour)
	title := filepath.Base(filename)
	job := models.TranscriptionJob{ID: id, Title: &title, AudioPath: path, AudioBytes: size, IsQuick: true, ExpiresAt: &expiry, Status: models.StatusPending, Parameters: params}
	if len(owners) > 0 {
		job.OwnerID = owners[0]
	}
	if err = q.jobRepo.Create(context.Background(), &job); err != nil {
		_ = os.Remove(path)
		return nil, err
	}
	if err = q.enqueue(id); err != nil {
		_ = q.jobRepo.UpdateStatus(context.Background(), id, models.StatusFailed)
		_ = q.jobRepo.UpdateError(context.Background(), id, err.Error())
		return nil, err
	}
	return quickView(&job), nil
}
func quickView(j *models.TranscriptionJob) *QuickTranscriptionJob {
	v := &QuickTranscriptionJob{OwnerID: j.OwnerID, ID: j.ID, Status: j.Status, Transcript: j.Transcript, Parameters: j.Parameters, CreatedAt: j.CreatedAt, ErrorMessage: j.ErrorMessage}
	if j.Title != nil {
		v.Filename = *j.Title
	}
	if j.ExpiresAt != nil {
		v.ExpiresAt = *j.ExpiresAt
	}
	return v
}
func (q *QuickTranscriptionService) GetQuickJob(id string) (*QuickTranscriptionJob, error) {
	j, err := q.jobRepo.FindByID(context.Background(), id)
	if err != nil || !j.IsQuick {
		return nil, fmt.Errorf("job not found")
	}
	if j.ExpiresAt == nil || !time.Now().Before(*j.ExpiresAt) {
		return nil, fmt.Errorf("job expired")
	}
	return quickView(j), nil
}
func (q *QuickTranscriptionService) ListQuickJobs(owner uint) ([]*QuickTranscriptionJob, error) {
	var jobs []models.TranscriptionJob
	err := database.DB.Where("owner_id = ? AND is_quick = ? AND expires_at > ?", owner, true, time.Now()).Order("created_at DESC").Limit(30).Find(&jobs).Error
	result := make([]*QuickTranscriptionJob, 0, len(jobs))
	for i := range jobs {
		result = append(result, quickView(&jobs[i]))
	}
	return result, err
}

// One explicit regular file per invocation. Never remove directories or follow symlinks.
func (q *QuickTranscriptionService) cleanupRoots(id string) []string {
	roots := []string{filepath.Join(q.config.TranscriptsDir, id), filepath.Join(q.tempDir, id+"_output")}
	// Older adapters retained scratch outside their actual output directory.
	for _, model := range []string{"whisperx", "sortformer", "sortformer_4spk", "pyannote", "parakeet", "canary", "funasr"} {
		roots = append(roots, filepath.Join(filepath.Dir(q.config.TranscriptsDir), "temp", model, id))
	}
	return roots
}

func (q *QuickTranscriptionService) cleanupOneFile(now time.Time) error {
	if database.DB == nil {
		return nil
	}
	var j models.TranscriptionJob
	result := database.DB.Unscoped().Where("is_quick = ? AND expires_at <= ? AND quick_cleaned_at IS NULL AND status NOT IN ?", true, now, []models.JobStatus{models.StatusPending, models.StatusProcessing}).Order("expires_at ASC").Limit(1).Find(&j)
	err := result.Error
	if err == nil && result.RowsAffected == 0 {
		return nil
	}
	if err == gorm.ErrRecordNotFound {
		return nil
	}
	if err != nil {
		return err
	}
	paths := j.QuickCleanupFiles
	if len(paths) == 0 {
		if j.AudioPath != "" {
			paths = append(paths, j.AudioPath)
			converted := strings.TrimSuffix(j.AudioPath, filepath.Ext(j.AudioPath)) + "_converted.wav"
			if info, err := os.Lstat(converted); err == nil && info.Mode().IsRegular() {
				paths = append(paths, converted)
			}
		}
		for _, dir := range q.cleanupRoots(j.ID) {
			walkErr := filepath.WalkDir(dir, func(p string, d os.DirEntry, e error) error {
				if os.IsNotExist(e) {
					return nil
				}
				if e != nil {
					return e
				}
				if d.Type().IsRegular() {
					paths = append(paths, p)
				}
				return nil
			})
			if walkErr != nil {
				return walkErr
			}
		}
		j.QuickCleanupFiles = paths
		if err := database.DB.Unscoped().Save(&j).Error; err != nil {
			return err
		}
	}
	if len(paths) > 0 {
		path := paths[0]
		if err := q.removeKnownFile(j.ID, path); err != nil {
			return err
		}
		j.QuickCleanupFiles = paths[1:]
		// Empty the primary path after its explicit file has been removed.
		if path == j.AudioPath {
			j.AudioPath = ""
			j.AudioBytes = 0
		}
		if len(j.QuickCleanupFiles) > 0 {
			return database.DB.Unscoped().Save(&j).Error
		}
	}
	// Content expires too; keep only a minimal cleanup audit record.
	return database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("transcription_job_id = ?", j.ID).Delete(&models.TranscriptionJobExecution{}).Error; err != nil {
			return err
		}
		return tx.Unscoped().Model(&j).Updates(map[string]interface{}{"transcript": nil, "audio_path": "", "audio_bytes": 0, "quick_cleanup_files": "[]", "quick_cleaned_at": now}).Error
	})
}
func (q *QuickTranscriptionService) removeKnownFile(id, path string) error {
	abs, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	allowed := q.cleanupRoots(id)
	tempRoot, _ := filepath.Abs(q.tempDir)
	if filepath.Dir(abs) == tempRoot && (strings.TrimSuffix(filepath.Base(abs), filepath.Ext(abs)) == id || filepath.Base(abs) == id+"_converted.wav") {
		allowed = append(allowed, tempRoot)
	}
	expected := ""
	for _, root := range allowed {
		r, _ := filepath.Abs(root)
		rel, e := filepath.Rel(r, abs)
		if e == nil && rel != "." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)) && rel != ".." {
			realRoot, e := filepath.EvalSymlinks(r)
			if os.IsNotExist(e) {
				return nil
			}
			if e != nil {
				return e
			}
			expected = filepath.Join(realRoot, rel)
			break
		}
	}
	if expected == "" {
		return fmt.Errorf("cleanup path outside task storage")
	}
	info, err := os.Lstat(abs)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("cleanup only supports ordinary files")
	}
	real, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return err
	}
	if real != expected {
		return fmt.Errorf("cleanup refuses symlink ancestors")
	}
	return os.Remove(abs)
}
