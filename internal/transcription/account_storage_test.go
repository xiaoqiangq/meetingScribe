package transcription

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"scriberr/internal/config"
	"scriberr/internal/database"
	"scriberr/internal/models"
	"scriberr/internal/repository"
)

func TestAccountQuickUploadStorageAndCleanup(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	conn, _ := db.DB()
	defer conn.Close()
	conn.SetMaxOpenConns(1)
	old := database.DB
	database.DB = db
	defer func() { database.DB = old }()
	if err := db.AutoMigrate(&models.User{}, &models.TranscriptionJob{}); err != nil {
		t.Fatal(err)
	}
	users := []models.User{{Username: "alice", Password: "test"}, {Username: "bob", Password: "test"}}
	for i := range users {
		if err := db.Create(&users[i]).Error; err != nil {
			t.Fatal(err)
		}
	}
	root, err := os.MkdirTemp("", "meetingscribe-quick-owner-")
	if err != nil {
		t.Fatal(err)
	}
	legacy := filepath.Join(root, "quick_transcriptions")
	if err := os.Mkdir(legacy, 0700); err != nil {
		t.Fatal(err)
	}
	q := &QuickTranscriptionService{config: &config.Config{UploadDir: root, TranscriptsDir: filepath.Join(root, "transcripts")}, tempDir: legacy, jobRepo: repository.NewJobRepository(db), enqueue: func(string) error { return nil }}
	var jobs []models.TranscriptionJob
	for _, u := range users {
		v, err := q.SubmitQuickJob(bytes.NewBufferString("quick-audio"), "test.wav", models.WhisperXParams{}, u.ID)
		if err != nil {
			t.Fatal(err)
		}
		j, err := q.jobRepo.FindByID(context.Background(), v.ID)
		if err != nil {
			t.Fatal(err)
		}
		if j.OwnerID != u.ID || filepath.Dir(j.AudioPath) != filepath.Join(root, u.Username, "quick_transcriptions") {
			t.Fatal("wrong quick namespace", j.AudioPath)
		}
		jobs = append(jobs, *j)
	}
	if err := q.removeKnownFile(jobs[0].ID, jobs[1].AudioPath); err == nil {
		t.Fatal("cleanup crossed user directories")
	}
	for _, j := range jobs {
		if err := q.removeKnownFile(j.ID, j.AudioPath); err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(j.AudioPath); !os.IsNotExist(err) {
			t.Fatal("exact quick file not removed")
		}
	}
	output := filepath.Join(root, "alice", "quick_transcriptions", jobs[0].ID+"_output")
	if err := os.Mkdir(output, 0700); err != nil {
		t.Fatal(err)
	}
	artifact := filepath.Join(output, "result.json")
	if err := os.WriteFile(artifact, []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := q.removeKnownFile(jobs[0].ID, artifact); err != nil {
		t.Fatal("account quick scratch cannot expire", err)
	}
	// Existing quick recordings remain eligible for exact-path cleanup.
	p := filepath.Join(legacy, "legacy.wav")
	if err := os.WriteFile(p, []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := q.removeKnownFile("legacy", p); err != nil {
		t.Fatal(err)
	}
}
