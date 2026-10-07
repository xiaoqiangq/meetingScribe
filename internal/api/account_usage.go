package api

import (
	"errors"
	"github.com/gin-gonic/gin"
	"io/fs"
	"os"
	"path/filepath"
	"scriberr/internal/database"
	"scriberr/internal/models"
)

type AccountUsage struct {
	ProjectCount    int   `json:"project_count"`
	CompletedCount  int   `json:"completed_count"`
	ActiveCount     int   `json:"active_count"`
	AudioBytes      int64 `json:"audio_bytes"`
	ArtifactBytes   int64 `json:"artifact_bytes"`
	StorageBytes    int64 `json:"storage_bytes"`
	QuotaBytes      int64 `json:"quota_bytes"`
	UsageIncomplete bool  `json:"usage_incomplete"`
}
type AccountWithUsage struct {
	models.User
	AccountUsage
}

func measureAccountPath(path string, seen map[string]bool) (int64, bool) {
	if path == "" {
		return 0, false
	}
	var total int64
	incomplete := false
	err := filepath.WalkDir(path, func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			if !errors.Is(err, os.ErrNotExist) {
				incomplete = true
			}
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 || entry.IsDir() {
			return nil
		}
		absolute, err := filepath.Abs(name)
		if err != nil {
			incomplete = true
			return nil
		}
		if seen[absolute] {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			incomplete = true
			return nil
		}
		if info.Mode().IsRegular() {
			seen[absolute] = true
			total += info.Size()
		}
		return nil
	})
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		incomplete = true
	}
	return total, incomplete
}
func (h *Handler) accountUsage(users []models.User) (map[uint]AccountUsage, error) {
	result := map[uint]AccountUsage{}
	ids := make([]uint, 0, len(users))
	seen := map[uint]map[string]bool{}
	for _, user := range users {
		ids = append(ids, user.ID)
		result[user.ID] = AccountUsage{QuotaBytes: effectiveAudioQuota(user)}
		seen[user.ID] = map[string]bool{}
	}
	if len(ids) == 0 {
		return result, nil
	}
	var jobs []models.TranscriptionJob
	if err := database.DB.Where("owner_id IN ?", ids).Find(&jobs).Error; err != nil {
		return nil, err
	}
	for _, job := range jobs {
		usage := result[job.OwnerID]
		usage.ProjectCount++
		if job.Status == models.StatusCompleted {
			usage.CompletedCount++
		}
		if job.Status == models.StatusPending || job.Status == models.StatusProcessing {
			usage.ActiveCount++
		}
		usage.AudioBytes += job.AudioBytes
		for _, path := range []string{job.AudioPath, pointerPath(job.AupFilePath), pointerPath(job.MultiTrackFolder), pointerPath(job.MergedAudioPath), filepath.Join(h.config.TranscriptsDir, job.ID)} {
			bytes, incomplete := measureAccountPath(path, seen[job.OwnerID])
			usage.StorageBytes += bytes
			usage.UsageIncomplete = usage.UsageIncomplete || incomplete
		}
		usage.ArtifactBytes = usage.StorageBytes - usage.AudioBytes
		if usage.ArtifactBytes < 0 {
			usage.ArtifactBytes = 0
		}
		result[job.OwnerID] = usage
	}
	return result, nil
}
func pointerPath(path *string) string {
	if path == nil {
		return ""
	}
	return *path
}

func effectiveAudioQuota(user models.User) int64 {
	if user.AudioQuotaBytes > 0 {
		return user.AudioQuotaBytes
	}
	return envBytes("USER_STORAGE_QUOTA_BYTES", 20<<30)
}
func (h *Handler) CurrentUserUsage(c *gin.Context) {
	user, err := h.userRepo.FindByID(c.Request.Context(), c.GetUint("user_id"))
	if err != nil {
		c.JSON(401, gin.H{"error": "Not authenticated"})
		return
	}
	stats, err := h.accountUsage([]models.User{*user})
	if err != nil {
		c.JSON(500, gin.H{"error": "Unable to read account usage"})
		return
	}
	c.JSON(200, AccountWithUsage{User: *user, AccountUsage: stats[user.ID]})
}
