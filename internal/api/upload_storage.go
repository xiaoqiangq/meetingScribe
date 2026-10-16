package api

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"scriberr/internal/database"
	"scriberr/internal/storage"
)

func (h *Handler) uploadDirectory(c *gin.Context) (string, bool) {
	path, err := storage.EnsureUserUploads(c.Request.Context(), database.DB, h.config.UploadDir, c.GetUint("user_id"))
	if err != nil {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "Unable to prepare account upload storage"})
		return "", false
	}
	return path, true
}
