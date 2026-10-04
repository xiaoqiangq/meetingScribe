package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"scriberr/internal/models"
)

func parseTopicUpload(c *gin.Context) (bool, []float64, error) {
	mode := c.PostForm("upload_mode")
	if mode == "" || mode == "short" {
		return false, nil, nil
	}
	if mode != "long" {
		return false, nil, fmt.Errorf("invalid upload mode")
	}
	var points []float64
	if err := json.Unmarshal([]byte(c.PostForm("topic_boundaries")), &points); err != nil {
		return false, nil, fmt.Errorf("invalid topic boundaries")
	}
	return true, points, models.ValidateTopicBoundaries(points, 0)
}

// Recommendations are immutable suggestions. The existing explicit speaker
// mapping save remains the only operation that applies names to transcripts.
func (h *Handler) GetTopicRecommendations(c *gin.Context) {
	id := c.Param("id")
	if _, err := uuid.Parse(id); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid job ID"})
		return
	}
	job, err := h.jobRepo.FindByID(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Job not found"})
		return
	}
	raw, err := os.ReadFile(filepath.Join(h.config.TranscriptsDir, id, "topic-recommendations.json"))
	if err != nil {
		if !job.Parameters.TopicMode {
			c.JSON(http.StatusOK, gin.H{"speakers": []interface{}{}, "links": []interface{}{}})
			return
		}
		c.JSON(http.StatusOK, gin.H{"speakers": []interface{}{}, "links": []interface{}{}, "notice": "声纹推荐尚未生成，请检查任务执行日志。"})
		return
	}
	if !json.Valid(raw) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid recommendation result"})
		return
	}
	c.Data(http.StatusOK, "application/json", raw)
}
