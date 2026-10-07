package api

import (
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"os"
	"path/filepath"
	"scriberr/internal/config"
	"scriberr/internal/database"
	"scriberr/internal/models"
	"testing"
)

func TestAccountUsageIsolationAndFileDeduplication(t *testing.T) {
	root, err := os.MkdirTemp("", "account-usage-test-")
	if err != nil {
		t.Fatal(err)
	}
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sql, _ := db.DB()
	sql.SetMaxOpenConns(1)
	defer sql.Close()
	previous := database.DB
	database.DB = db
	defer func() { database.DB = previous }()
	if err = db.AutoMigrate(&models.TranscriptionJob{}); err != nil {
		t.Fatal(err)
	}
	audio := filepath.Join(root, "a.wav")
	os.WriteFile(audio, []byte("audio"), 0600)
	out := filepath.Join(root, "transcripts", "job-a")
	os.MkdirAll(out, 0700)
	os.WriteFile(filepath.Join(out, "result.json"), []byte("result"), 0600)
	for _, job := range []models.TranscriptionJob{{ID: "job-a", OwnerID: 1, AudioPath: audio, AudioBytes: 5, Status: models.StatusCompleted, MergedAudioPath: &audio}, {ID: "job-b", OwnerID: 2, AudioPath: filepath.Join(root, "missing"), Status: models.StatusProcessing}} {
		if err = db.Create(&job).Error; err != nil {
			t.Fatal(err)
		}
	}
	h := &Handler{config: &config.Config{TranscriptsDir: filepath.Join(root, "transcripts")}}
	stats, err := h.accountUsage([]models.User{{ID: 1}, {ID: 2}, {ID: 3}})
	if err != nil {
		t.Fatal(err)
	}
	a := stats[1]
	if a.ProjectCount != 1 || a.CompletedCount != 1 || a.StorageBytes != 11 || a.AudioBytes != 5 || a.ArtifactBytes != 6 {
		t.Fatalf("wrong user1 usage: %+v", a)
	}
	if stats[2].ActiveCount != 1 || stats[2].StorageBytes != 0 || stats[3].ProjectCount != 0 {
		t.Fatalf("ownership mixed: %+v", stats)
	}
	// Soft-deleted jobs are excluded from current project counts and usage.
	db.Delete(&models.TranscriptionJob{}, "id = ?", "job-a")
	stats, err = h.accountUsage([]models.User{{ID: 1}})
	if err != nil || stats[1].ProjectCount != 0 {
		t.Fatalf("deleted task counted: %+v %v", stats, err)
	}
}
