// Package storage resolves durable, account-owned upload directories.
package storage

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"gorm.io/gorm"
	"scriberr/internal/models"
)

var readableName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,49}$`)
var fallbackName = regexp.MustCompile(`^_user-[1-9][0-9]*$`)
var legacyJobName = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// DirectoryName keeps ordinary usernames readable; unsafe/reserved names use ID.
func DirectoryName(id uint, username string) string {
	if readableName.MatchString(username) && !legacyJobName.MatchString(username) && !strings.EqualFold(username, "quick_transcriptions") {
		return username
	}
	return fmt.Sprintf("_user-%d", id)
}

// UserUploadPath reserves a stable namespace in the DB. Renaming an account
// must not strand old recordings or transfer its directory to a different user.
func UserUploadPath(ctx context.Context, db *gorm.DB, base string, owner uint) (string, error) {
	if db == nil || owner == 0 || base == "" {
		return "", fmt.Errorf("authenticated upload owner unavailable")
	}
	var name string
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var user models.User
		if err := tx.First(&user, owner).Error; err != nil {
			return err
		}
		if user.UploadDirectory != nil {
			name = *user.UploadDirectory
		} else {
			name = DirectoryName(owner, user.Username)
			var count int64
			if err := tx.Model(&models.User{}).Where("LOWER(upload_directory) = LOWER(?) AND id <> ?", name, owner).Count(&count).Error; err != nil {
				return err
			}
			if count != 0 {
				name = fmt.Sprintf("_user-%d", owner)
			}
			if err := tx.Model(&user).Update("upload_directory", name).Error; err != nil {
				return err
			}
		}
		if !(readableName.MatchString(name) || fallbackName.MatchString(name)) || legacyJobName.MatchString(name) || strings.EqualFold(name, "quick_transcriptions") {
			return fmt.Errorf("invalid account upload directory")
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	return filepath.Join(base, name), nil
}

// EnsureDirectory rejects symlinks at the account/subdirectory boundary.
func EnsureDirectory(path string) error {
	if err := os.Mkdir(path, 0700); err != nil && !os.IsExist(err) {
		return err
	}
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("upload storage must be a real directory")
	}
	return nil
}

func EnsureUserUploads(ctx context.Context, db *gorm.DB, base string, owner uint) (string, error) {
	path, err := UserUploadPath(ctx, db, base, owner)
	if err != nil {
		return "", err
	}
	if err = os.MkdirAll(base, 0700); err == nil {
		err = EnsureDirectory(path)
	}
	return path, err
}
