package api

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"scriberr/internal/database"
	"scriberr/internal/models"
)

// WAV makes each saved PCM prefix playable without depending on WebM finalization.
func liveWAVHeader(size int64) []byte {
	b := make([]byte, 44)
	copy(b, "RIFF")
	binary.LittleEndian.PutUint32(b[4:], uint32(size+36))
	copy(b[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(b[16:], 16)
	binary.LittleEndian.PutUint16(b[20:], 1)
	binary.LittleEndian.PutUint16(b[22:], 1)
	binary.LittleEndian.PutUint32(b[24:], 16000)
	binary.LittleEndian.PutUint32(b[28:], 32000)
	binary.LittleEndian.PutUint16(b[32:], 2)
	binary.LittleEndian.PutUint16(b[34:], 16)
	copy(b[36:], "data")
	binary.LittleEndian.PutUint32(b[40:], uint32(size))
	return b
}

func (h *Handler) liveQuota(ctx context.Context, owner uint, additional int64, creating bool) error {
	if database.DB == nil {
		return fmt.Errorf("account limits unavailable")
	}
	var user models.User
	if err := database.DB.WithContext(ctx).First(&user, owner).Error; err != nil {
		return fmt.Errorf("account limits unavailable")
	}
	var count, used int64
	query := database.DB.WithContext(ctx).Model(&models.TranscriptionJob{}).Where("owner_id = ?", owner)
	if err := query.Count(&count).Error; err != nil {
		return err
	}
	if creating && user.ProjectLimit > 0 && count >= user.ProjectLimit {
		return fmt.Errorf("account project limit reached")
	}
	if err := database.DB.WithContext(ctx).Model(&models.TranscriptionJob{}).Where("owner_id = ?", owner).Select("COALESCE(SUM(audio_bytes),0)").Scan(&used).Error; err != nil {
		return err
	}
	if used+additional > effectiveAudioQuota(user) {
		return fmt.Errorf("account audio storage quota exceeded")
	}
	if user.FileQuotaBytes > 0 {
		stats, err := h.accountUsage([]models.User{user})
		if err != nil || stats[owner].UsageIncomplete {
			return fmt.Errorf("storage quota check unavailable")
		}
		if stats[owner].StorageBytes+additional > user.FileQuotaBytes {
			return fmt.Errorf("account file storage limit reached")
		}
	}
	return nil
}

func (h *Handler) createLiveProject(c *gin.Context, s *liveSession, data []byte) error {
	if err := h.liveQuota(c.Request.Context(), s.Owner, 44, true); err != nil {
		return err
	}
	if err := os.MkdirAll(h.config.UploadDir, 0700); err != nil {
		return err
	}
	id := uuid.NewString()
	path := filepath.Join(h.config.UploadDir, id+".wav")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	_, err = f.Write(liveWAVHeader(0))
	if err == nil {
		err = f.Sync()
	}
	f.Close()
	if err != nil {
		_ = os.Remove(path)
		return err
	}
	title := "Live recording " + time.Now().Format(time.RFC3339)
	// Prepare the durable result before inserting the project, so creation has
	// one database write and cannot leave a half-initialized processing job.
	s.SavedID = id
	s.AudioPath = path
	result, err := liveSavedResult(s, data)
	if err != nil {
		_ = os.Remove(path)
		return err
	}
	transcript := string(result)
	job := models.TranscriptionJob{ID: id, OwnerID: s.Owner, AudioPath: path, AudioBytes: 44, Title: &title, Status: models.StatusProcessing, Diarization: true, Transcript: &transcript}
	job.Parameters.ModelFamily = "funasr"
	job.Parameters.Model = "Qwen/Qwen3-ASR-1.7B"
	job.Parameters.Task = "realtime"
	if err = h.jobRepo.Create(c.Request.Context(), &job); err != nil {
		_ = os.Remove(path)
		return err
	}
	s.Result = append(json.RawMessage(nil), result...)
	return nil
}

func liveSavedResult(s *liveSession, data []byte) ([]byte, error) {
	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, err
	}
	if result == nil {
		return nil, fmt.Errorf("empty realtime response")
	}
	result["job_id"] = s.SavedID
	result["saved_duration"] = float64(s.AudioSize) / 32000
	metadata, ok := result["metadata"].(map[string]interface{})
	if !ok {
		metadata = map[string]interface{}{}
		result["metadata"] = metadata
	}
	metadata["mode"] = "realtime"
	metadata["live_active"] = !s.Finished
	metadata["audio_format"] = "PCM16 mono 16000 Hz WAV"
	return json.Marshal(result)
}

func (h *Handler) persistLive(ctx context.Context, s *liveSession, data []byte, status models.JobStatus, message string) error {
	result, err := liveSavedResult(s, data)
	if err != nil {
		return err
	}
	if err = h.jobRepo.UpdateRealtime(ctx, s.SavedID, string(result), 44+s.AudioSize, status, message); err != nil {
		return err
	}
	s.Result = append(json.RawMessage(nil), result...)
	return nil
}

func (h *Handler) appendLiveAudio(c *gin.Context, s *liveSession, body []byte) error {
	n, err := strconv.Atoi(c.Query("sequence"))
	if err != nil || n < 0 || len(body) == 0 || len(body)%2 != 0 || len(body) > 64000 {
		return fmt.Errorf("invalid audio sequence or PCM chunk")
	}
	hash := sha256.Sum256(body)
	if n == s.RecordedSequence-1 && hash == s.LastAudioHash {
		return h.persistLive(c.Request.Context(), s, s.Result, models.StatusProcessing, "")
	}
	if n != s.RecordedSequence {
		return fmt.Errorf("unexpected audio sequence")
	}
	if s.AudioSize+int64(len(body)) > 32000*1800 {
		return fmt.Errorf("recording limit is 30 minutes")
	}
	if err = h.liveQuota(c.Request.Context(), s.Owner, int64(len(body)), false); err != nil {
		return err
	}
	f, err := os.OpenFile(s.AudioPath, os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err = f.WriteAt(body, 44+s.AudioSize); err != nil {
		return err
	}
	size := s.AudioSize + int64(len(body))
	if _, err = f.WriteAt(liveWAVHeader(size), 0); err != nil {
		return err
	}
	if err = f.Sync(); err != nil {
		return err
	}
	s.AudioSize = size
	s.RecordedSequence++
	s.LastAudioHash = hash
	return h.persistLive(c.Request.Context(), s, s.Result, models.StatusProcessing, "")
}

// The timer survives a browser disappearing; already saved audio/text is retained.
func (h *Handler) expireLiveProject(s *liveSession) {
	time.AfterFunc(90*time.Second, func() {
		h.liveMu.Lock()
		defer h.liveMu.Unlock()
		if s.Finished {
			return
		}
		if time.Since(s.Touched) < 90*time.Second {
			h.expireLiveProject(s)
			return
		}
		s.Finished = true
		if s.SavedID != "" {
			if err := h.persistLive(context.Background(), s, s.Result, models.StatusFailed, "Realtime recording interrupted; saved audio and text retained"); err != nil {
				s.Finished = false
				h.expireLiveProject(s)
			}
		}
		if h.liveSession == s {
			h.taskQueue.ReleaseRealtime()
		}
	})
}
