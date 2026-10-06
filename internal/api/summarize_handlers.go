package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"scriberr/internal/llm"
	"scriberr/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type SummarizeRequest struct {
	Model           string  `json:"model" binding:"required"`
	Content         string  `json:"content" binding:"required"`
	TranscriptionID string  `json:"transcription_id" binding:"required"`
	TemplateID      *string `json:"template_id,omitempty"`
}

// Summarize streams LLM output for a given content prompt
// @Summary Summarize content
// @Description Stream an LLM-generated summary for provided content; persists latest summary for the transcription
// @Tags summarize
// @Accept json
// @Produce text/event-stream
// @Param request body SummarizeRequest true "Summarize request"
// @Success 200 {string} string "Event stream"
// @Failure 400 {object} map[string]string
// @Failure 500 {object} map[string]string
// @Security ApiKeyAuth
// @Security BearerAuth
// @Router /api/v1/summarize [post]
func (h *Handler) Summarize(c *gin.Context) {
	var req SummarizeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if !h.requireOwnedJob(c, req.TranscriptionID) {
		return
	}
	svc, provider, err := h.getLLMService(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Prepare chat messages: simple single-user message with full content
	messages := []llm.ChatMessage{{Role: "user", Content: req.Content}}

	start := time.Now()
	log.Printf("[summarize] start transcription_id=%s provider=%s model=%s content_len=%d", req.TranscriptionID, provider, req.Model, len(req.Content))

	// Stream response with proper headers for real-time delivery
	c.Header("Content-Type", "application/x-ndjson; charset=utf-8")
	c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
	c.Header("Connection", "keep-alive")
	c.Header("Transfer-Encoding", "chunked")
	c.Header("X-Accel-Buffering", "no") // Disable nginx buffering
	c.Status(http.StatusOK)             // Start response immediately

	h.processSummarization(c, req, svc, messages, start)
}

// Events make a successful end explicit: a disconnected stream is never completion.
func (h *Handler) processSummarization(c *gin.Context, req SummarizeRequest, svc llm.Service, messages []llm.ChatMessage, start time.Time) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Minute)
	defer cancel()
	chunks, failures := svc.ChatCompletionStream(ctx, req.Model, messages, 0)
	var text strings.Builder
	var streamErr error
	emit := func(event gin.H) error {
		if err := json.NewEncoder(c.Writer).Encode(event); err != nil {
			return err
		}
		c.Writer.Flush()
		return nil
	}
	// Both channels must close before success; providers may close chunks before sending an error.
	for chunks != nil || failures != nil {
		select {
		case chunk, ok := <-chunks:
			if !ok {
				chunks = nil
				continue
			}
			text.WriteString(chunk)
			if err := emit(gin.H{"type": "chunk", "content": chunk}); err != nil {
				streamErr = err
				cancel()
				chunks = nil
				failures = nil
			}
		case err, ok := <-failures:
			if !ok {
				failures = nil
				continue
			}
			if err != nil {
				streamErr = err
			}
		case <-ctx.Done():
			streamErr = ctx.Err()
			chunks = nil
			failures = nil
		}
	}
	if ctx.Err() != nil {
		streamErr = ctx.Err()
	}
	// Streaming fallback is safe only before any content was emitted.
	if streamErr != nil && text.Len() == 0 && ctx.Err() == nil && (strings.Contains(streamErr.Error(), "unsupported_value") || strings.Contains(streamErr.Error(), "must be verified to stream") || strings.Contains(streamErr.Error(), "\"param\": \"stream\"")) {
		resp, err := svc.ChatCompletion(ctx, req.Model, messages, 0)
		if err == nil && resp != nil && len(resp.Choices) > 0 {
			text.WriteString(resp.Choices[0].Message.Content)
			streamErr = emit(gin.H{"type": "chunk", "content": text.String()})
			reason := resp.Choices[0].FinishReason
			if reason != "stop" && reason != "" {
				streamErr = fmt.Errorf("summary ended with finish reason: %s", reason)
			}
		} else if err != nil {
			streamErr = err
		}
	}
	status, message := "completed", ""
	if streamErr == nil && strings.TrimSpace(text.String()) == "" {
		streamErr = fmt.Errorf("Model returned an empty summary")
	}
	if streamErr != nil {
		status = "failed"
		if text.Len() > 0 {
			status = "partial"
		}
		message = streamErr.Error()
	}
	sum := &models.Summary{TranscriptionID: req.TranscriptionID, TemplateID: req.TemplateID, Model: req.Model, Content: text.String(), Status: status, ErrorMessage: message}
	saveCtx, saveCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer saveCancel()
	if err := h.summaryRepo.SaveSummary(saveCtx, sum); err != nil {
		_ = emit(gin.H{"type": "error", "status": "failed", "error": "Failed to save summary"})
		return
	}
	if status == "completed" {
		_ = h.jobRepo.UpdateSummary(saveCtx, req.TranscriptionID, text.String())
		_ = emit(gin.H{"type": "done", "status": status, "summary_id": sum.ID})
	} else {
		_ = emit(gin.H{"type": "error", "status": status, "error": message, "summary_id": sum.ID})
	}
	log.Printf("[summarize] end transcription_id=%s status=%s bytes=%d duration_ms=%d", req.TranscriptionID, status, text.Len(), time.Since(start).Milliseconds())
}

// GetSummaryHistory lists saved generations for a single recording, newest first.
func (h *Handler) GetSummaryHistory(c *gin.Context) {
	id := c.Param("id")
	if _, err := h.jobRepo.FindByID(c.Request.Context(), id); err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Transcription not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch transcription"})
		}
		return
	}
	entries, err := h.summaryRepo.ListSummaryHistory(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch summary history"})
		return
	}
	c.JSON(http.StatusOK, entries)
}

// GetSummaryForTranscription returns the latest summary for a transcription
// @Summary Get latest summary for transcription
// @Description Get the most recent saved summary for the given transcription
// @Tags summarize
// @Produce json
// @Param id path string true "Transcription ID"
// @Success 200 {object} models.Summary
// @Failure 404 {object} map[string]string
// @Failure 400 {object} map[string]string
// @Failure 500 {object} map[string]string
// @Security ApiKeyAuth
// @Security BearerAuth
// @Router /api/v1/transcription/{id}/summary [get]
func (h *Handler) GetSummaryForTranscription(c *gin.Context) {
	tid := c.Param("id")
	if tid == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Transcription ID required"})
		return
	}
	s, err := h.summaryRepo.GetLatestSummary(c.Request.Context(), tid)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			// Fallback: check if summary is cached on the job record
			job, err2 := h.jobRepo.FindByID(c.Request.Context(), tid)
			if err2 == nil && job.Summary != nil && *job.Summary != "" {
				c.JSON(http.StatusOK, gin.H{
					"transcription_id": tid,
					"template_id":      nil,
					"model":            "",
					"content":          *job.Summary,
					"created_at":       job.UpdatedAt,
					"updated_at":       job.UpdatedAt,
				})
				return
			}
			// Return empty summary instead of 404 for graceful frontend handling
			c.JSON(http.StatusOK, gin.H{
				"transcription_id": tid,
				"template_id":      nil,
				"model":            "",
				"content":          "",
				"created_at":       nil,
				"updated_at":       nil,
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch summary"})
		return
	}
	c.JSON(http.StatusOK, s)
}
