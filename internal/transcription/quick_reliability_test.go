package transcription

import (
	"context"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"os"
	"path/filepath"
	"scriberr/internal/config"
	"scriberr/internal/database"
	"scriberr/internal/models"
	"scriberr/internal/repository"
	"testing"
	"time"
)

func TestQuickExpirySurvivesRestartAndCleansActualOutputs(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	defer sqlDB.Close()
	previous := database.DB
	database.DB = db
	defer func() { database.DB = previous }()
	if err = db.AutoMigrate(&models.TranscriptionJob{}, &models.TranscriptionJobExecution{}); err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{UploadDir: filepath.Join(t.TempDir(), "uploads"), TranscriptsDir: filepath.Join(t.TempDir(), "transcripts")}
	repo := repository.NewJobRepository(db)
	q, err := NewQuickTranscriptionService(cfg, nil, repo)
	if err != nil {
		t.Fatal(err)
	}
	q.Close()
	id := "quick-restart"
	audio := filepath.Join(q.tempDir, id+".wav")
	out := filepath.Join(cfg.TranscriptsDir, id, "native-result.json")
	os.MkdirAll(filepath.Dir(out), 0700)
	os.WriteFile(audio, []byte("audio"), 0600)
	os.WriteFile(out, []byte("sensitive output"), 0600)
	converted := filepath.Join(q.tempDir, id+"_converted.wav")
	legacy := filepath.Join(filepath.Dir(cfg.TranscriptsDir), "temp", "sortformer", id, "result.json")
	os.MkdirAll(filepath.Dir(legacy), 0700)
	os.WriteFile(legacy, []byte("scratch"), 0600)
	os.WriteFile(converted, []byte("converted audio"), 0600)
	expiry := time.Now().Add(-time.Minute)
	text := "private transcript"
	job := models.TranscriptionJob{ID: id, OwnerID: 7, AudioPath: audio, IsQuick: true, ExpiresAt: &expiry, Status: models.StatusCompleted, Transcript: &text}
	if err = repo.Create(context.Background(), &job); err != nil {
		t.Fatal(err)
	}
	repo.Create(context.Background(), &models.TranscriptionJob{ID: "library", OwnerID: 7, AudioPath: "ordinary.wav"})
	// A new service reads the database, rather than losing expiry on restart.
	q, err = NewQuickTranscriptionService(cfg, nil, repo)
	if err != nil {
		t.Fatal(err)
	}
	q.Close()
	if _, err = q.GetQuickJob(id); err == nil {
		t.Fatal("expired task is readable")
	}
	if items, err := q.ListQuickJobs(7); err != nil || len(items) != 0 {
		t.Fatal("expired task appears in recovery list")
	}
	if err = q.cleanupOneFile(time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(audio); !os.IsNotExist(err) {
		t.Fatal("original audio not removed")
	}
	if _, err = os.Stat(out); err != nil {
		t.Fatal("more than one file was removed in one tick")
	}
	// Restart midway through cleanup resumes its durable manifest.
	q, err = NewQuickTranscriptionService(cfg, nil, repo)
	if err != nil {
		t.Fatal(err)
	}
	q.Close()
	for i := 0; i < 4; i++ {
		if err = q.cleanupOneFile(time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = os.Stat(out); !os.IsNotExist(err) {
		t.Fatal("actual native output was not cleaned")
	}
	restored, _ := repo.FindByID(context.Background(), id)
	if restored.Transcript != nil || restored.QuickCleanedAt == nil || restored.AudioBytes != 0 {
		t.Fatal("expired content still retained")
	}
	library, _ := repo.FindByID(context.Background(), "library")
	if library == nil {
		t.Fatal("library recording changed")
	}
}
func TestQuickCleanupRefusesOutsidePaths(t *testing.T) {
	dir := t.TempDir()
	q := &QuickTranscriptionService{config: &config.Config{TranscriptsDir: filepath.Join(dir, "transcripts")}, tempDir: filepath.Join(dir, "quick")}
	path := filepath.Join(dir, "keep.txt")
	os.WriteFile(path, []byte("keep"), 0600)
	if err := q.removeKnownFile("job", path); err == nil {
		t.Fatal("outside path accepted")
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal("outside file changed")
	}
}
