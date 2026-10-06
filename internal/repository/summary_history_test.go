package repository

import (
	"context"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"path/filepath"
	"scriberr/internal/models"
	"testing"
	"time"
)

func TestSummaryHistoryPreservesGenerations(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "history.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		"CREATE TABLE summaries (id TEXT PRIMARY KEY, transcription_id TEXT, template_id TEXT, model TEXT, content TEXT, status TEXT DEFAULT 'completed', error_message TEXT, created_at DATETIME, updated_at DATETIME)",
		"CREATE TABLE summary_templates (id TEXT PRIMARY KEY, name TEXT)",
		"INSERT INTO summary_templates VALUES ('first', '待核实优先'), ('second', '原版')",
	} {
		if err := db.Exec(sql).Error; err != nil {
			t.Fatal(err)
		}
	}
	repo := NewSummaryRepository(db)
	ctx := context.Background()
	first, second := "first", "second"
	start := time.Date(2026, 10, 3, 1, 0, 0, 0, time.UTC)
	for _, summary := range []models.Summary{
		{ID: "old", TranscriptionID: "meeting", TemplateID: &first, Model: "model", Content: "old content", CreatedAt: start},
		{ID: "new", TranscriptionID: "meeting", TemplateID: &second, Model: "model", Content: "new content", CreatedAt: start.Add(time.Minute)},
		{ID: "unrelated", TranscriptionID: "other", Model: "model", Content: "private content", CreatedAt: start.Add(time.Hour)},
	} {
		if err := repo.SaveSummary(ctx, &summary); err != nil {
			t.Fatal(err)
		}
	}
	entries, err := repo.ListSummaryHistory(ctx, "meeting")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 || entries[0].ID != "new" || entries[0].TemplateName != "原版" || entries[1].Content != "old content" || entries[1].TemplateName != "待核实优先" {
		t.Fatalf("unexpected history: %+v", entries)
	}
	if err := db.Exec("DELETE FROM summary_templates WHERE id = ?", second).Error; err != nil {
		t.Fatal(err)
	}
	entries, err = repo.ListSummaryHistory(ctx, "meeting")
	if err != nil || len(entries) != 2 || entries[0].TemplateName != "" {
		t.Fatalf("deleted template lost history: %+v, %v", entries, err)
	}
	empty, err := repo.ListSummaryHistory(ctx, "empty")
	if err != nil || empty == nil || len(empty) != 0 {
		t.Fatalf("expected empty array: %+v, %v", empty, err)
	}
}
