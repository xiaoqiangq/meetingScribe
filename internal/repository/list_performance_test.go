package repository

import (
	"context"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"scriberr/internal/models"
	"testing"
)

func TestLightweightListPreservesOwnershipAndFullDetails(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sql, _ := db.DB()
	sql.SetMaxOpenConns(1)
	defer sql.Close()
	if err = db.AutoMigrate(&models.TranscriptionJob{}); err != nil {
		t.Fatal(err)
	}
	text := "large transcript"
	summary := "meeting minutes"
	title := "meeting"
	for _, job := range []models.TranscriptionJob{
		{ID: "a", OwnerID: 1, Title: &title, AudioPath: "a.wav", Status: models.StatusCompleted, Transcript: &text, Summary: &summary, Parameters: models.WhisperXParams{TopicMode: true}},
		{ID: "b", OwnerID: 2, AudioPath: "b.wav", Transcript: &text},
	} {
		if err = db.Create(&job).Error; err != nil {
			t.Fatal(err)
		}
	}
	repo := NewJobRepository(db)
	ctx := models.WithRequestOwner(context.Background(), 1)
	jobs, count, err := repo.ListWithParams(WithLightweightJobList(ctx), 0, 20, "created_at", "desc", "meeting", nil)
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 || len(jobs) != 1 || jobs[0].ID != "a" || jobs[0].Transcript != nil || jobs[0].Summary != nil || !jobs[0].Parameters.TopicMode {
		t.Fatalf("incorrect lightweight list: %+v count=%d", jobs, count)
	}
	full, _, err := repo.ListWithParams(ctx, 0, 20, "", "", "", nil)
	if err != nil || len(full) != 1 || full[0].Transcript == nil || full[0].Summary == nil {
		t.Fatal("full list lost results", err)
	}
	detail, err := repo.FindByID(ctx, "a")
	if err != nil || detail.Transcript == nil || *detail.Transcript != text {
		t.Fatal("detail lost transcript", err)
	}
	if _, err = repo.FindByID(ctx, "b"); err == nil {
		t.Fatal("other owner's job exposed")
	}
}
