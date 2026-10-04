package api

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"scriberr/internal/models"
	"strings"
)

// ResourceAccess protects all paths and indirect resources before any handler runs.
func (h *Handler) ResourceAccess() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := ""
		path := c.FullPath()
		switch {
		case strings.HasPrefix(path, "/api/v1/transcription/"):
			if strings.Contains(path, "/quick/:id") {
				c.Next()
				return
			}
			id = c.Param("id")
		case strings.HasPrefix(path, "/api/v1/chat/"):
			id = c.Param("transcription_id")
			if sessionID := c.Param("session_id"); sessionID != "" {
				session, err := h.chatRepo.FindByID(c.Request.Context(), sessionID)
				if err != nil {
					c.AbortWithStatusJSON(404, gin.H{"error": "Not found"})
					return
				}
				id = session.TranscriptionID
			}
		case strings.HasPrefix(path, "/api/v1/notes/"):
			note, err := h.noteRepo.FindByID(c.Request.Context(), c.Param("note_id"))
			if err != nil {
				c.AbortWithStatusJSON(404, gin.H{"error": "Not found"})
				return
			}
			id = note.TranscriptionID
		case strings.HasPrefix(path, "/api/v1/events/"):
			id = c.Query("job_id")
		}
		if id != "" && !h.requireOwnedJob(c, id) {
			return
		}
		c.Next()
	}
}
func (h *Handler) requireOwnedJob(c *gin.Context, id string) bool {
	job, err := h.jobRepo.FindByID(c.Request.Context(), id)
	if err != nil || job.OwnerID != c.GetUint("user_id") || job.OwnerID == 0 {
		c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"error": "Not found"})
		return false
	}
	return true
}
func publicParams(p models.WhisperXParams) models.WhisperXParams {
	p.HfToken = nil
	p.APIKey = nil
	p.ModelDir = nil
	p.AlignModel = nil
	return p
}
