package storage

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"scriberr/internal/models"
	"scriberr/internal/repository"
)

func TestAccountUploadNamespaces(t *testing.T) {
	if DirectoryName(7, "12345678-1234-1234-1234-123456789abc") != "_user-7" {
		t.Fatal("username must not claim a legacy multitrack job directory")
	}
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	conn, _ := db.DB()
	defer conn.Close()
	conn.SetMaxOpenConns(1)
	if err := db.AutoMigrate(&models.User{}); err != nil {
		t.Fatal(err)
	}
	root, err := os.MkdirTemp("", "meetingscribe-user-storage-")
	if err != nil {
		t.Fatal(err)
	}
	// Retain fixture directories; no recursive cleanup.
	ctx := context.Background()
	a := models.User{Username: "alice", Password: "test"}
	b := models.User{Username: "bob", Password: "test"}
	bad := models.User{Username: "../escape", Password: "test"}
	for _, u := range []*models.User{&a, &b, &bad} {
		if err := db.Create(u).Error; err != nil {
			t.Fatal(err)
		}
	}
	first, err := EnsureUserUploads(ctx, db, root, a.ID)
	if err != nil || first != filepath.Join(root, "alice") {
		t.Fatalf("alice storage: %s %v", first, err)
	}
	second, err := EnsureUserUploads(ctx, db, root, b.ID)
	if err != nil || second != filepath.Join(root, "bob") {
		t.Fatalf("bob storage: %s %v", second, err)
	}
	// This struct predates namespace reservation and still has a nil field.
	a.Username = "renamed"
	if err := repository.NewUserRepository(db).Update(ctx, &a); err != nil {
		t.Fatal(err)
	}
	again, err := EnsureUserUploads(ctx, db, root, a.ID)
	if err != nil || again != first {
		t.Fatal("renaming must preserve stored namespace", err)
	}
	reused := models.User{Username: "ALICE", Password: "test"}
	db.Create(&reused)
	reusedPath, err := EnsureUserUploads(ctx, db, root, reused.ID)
	if err != nil || reusedPath == first || filepath.Base(reusedPath) != "_user-4" {
		t.Fatal("case/reused name collision", reusedPath, err)
	}
	badPath, err := EnsureUserUploads(ctx, db, root, bad.ID)
	if err != nil || filepath.Dir(badPath) != root || filepath.Base(badPath) != "_user-3" {
		t.Fatal("unsafe username escaped storage", badPath, err)
	}
	if _, err := EnsureUserUploads(ctx, db, root, 0); err == nil {
		t.Fatal("unowned upload accepted")
	}
	if _, err := EnsureUserUploads(ctx, db, root, 999); err == nil {
		t.Fatal("unknown owner accepted")
	}
}

func TestAccountUploadRejectsSymlinkDirectory(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	conn, _ := db.DB()
	defer conn.Close()
	conn.SetMaxOpenConns(1)
	if err := db.AutoMigrate(&models.User{}); err != nil {
		t.Fatal(err)
	}
	u := models.User{Username: "alice", Password: "test"}
	db.Create(&u)
	root, err := os.MkdirTemp("", "meetingscribe-user-symlink-")
	if err != nil {
		t.Fatal(err)
	}
	outside, err := os.MkdirTemp("", "meetingscribe-user-outside-")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "alice")); err != nil {
		t.Fatal(err)
	}
	if _, err := EnsureUserUploads(context.Background(), db, root, u.ID); err == nil {
		t.Fatal("symlink account directory accepted")
	}
}
