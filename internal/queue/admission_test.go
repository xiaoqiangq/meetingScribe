package queue

import (
	"context"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"scriberr/internal/models"
	"scriberr/internal/repository"
	"testing"
)

func TestSharedAdmissionIncludesQuickAndLibraryAndDeduplicates(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	defer sqlDB.Close()
	db.AutoMigrate(&models.TranscriptionJob{})
	repo := repository.NewJobRepository(db)
	q := NewTaskQueue(1, nil, repo)
	defer q.cancel()
	for i, id := range []string{"quick", "library", "third", "fourth"} {
		repo.Create(context.Background(), &models.TranscriptionJob{ID: id, OwnerID: 7, AudioPath: "audio", IsQuick: i == 0, Status: models.StatusPending})
		err = q.EnqueueJob(id)
		if i < 3 && err != nil {
			t.Fatal(err)
		}
		if i == 3 && err == nil {
			t.Fatal("per-user limit not enforced")
		}
	}
	if err = q.EnqueueJob("quick"); err != nil {
		t.Fatal(err)
	}
	if len(q.jobChannel) != 3 {
		t.Fatal("duplicate entered GPU queue")
	}
}
