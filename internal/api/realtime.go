package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"github.com/gin-gonic/gin"
	"scriberr/internal/models"
)

type liveSession struct {
	ID               string
	Owner            uint
	Touched          time.Time
	Finished         bool
	FinishRequested  bool
	SavedID          string
	AudioPath        string
	AudioSize        int64
	RecordedSequence int
	LastAudioHash    [32]byte
	Result           json.RawMessage
}

// The service is deliberately loopback-only; clients cannot choose its URL.
func realtimeURL() (string, error) {
	raw := os.Getenv("MEETINGSCRIBE_REALTIME_URL")
	u, err := url.Parse(raw)
	if err != nil || u == nil || u.Scheme != "http" || (u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost") || u.User != nil || u.RawQuery != "" || u.Path != "" || u.Fragment != "" {
		return "", fmt.Errorf("realtime service is not configured")
	}
	return raw, nil
}

func liveCall(c *gin.Context, path string, body []byte) (int, []byte, error) {
	base, err := realtimeURL()
	if err != nil {
		return 503, nil, err
	}
	method := "POST"
	if path == "/status" {
		method = "GET"
	}
	req, err := http.NewRequestWithContext(c.Request.Context(), method, base+path, bytes.NewReader(body))
	if err != nil {
		return 503, nil, err
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	timeout := 60 * time.Second
	if path == "/sessions" {
		// Cold starts load and warm all models before microphone recording begins.
		timeout = 10 * time.Minute
	}
	client := &http.Client{Timeout: timeout, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(req)
	if err != nil {
		return 503, nil, fmt.Errorf("realtime service unavailable")
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if err != nil || !json.Valid(data) {
		return 503, nil, fmt.Errorf("invalid realtime response")
	}
	return response.StatusCode, data, nil
}

func (h *Handler) RealtimeStatus(c *gin.Context) {
	code, data, err := liveCall(c, "/status", nil)
	if err != nil {
		c.JSON(200, gin.H{"available": false})
		return
	}
	c.Data(code, "application/json", data)
}

func (h *Handler) StartRealtime(c *gin.Context) {
	h.liveMu.Lock()
	defer h.liveMu.Unlock()
	for id, old := range h.liveFinished {
		if old.SavedID != "" || time.Since(old.Touched) > 30*time.Minute {
			delete(h.liveFinished, id)
		}
	}
	if len(h.liveFinished) >= 16 {
		c.JSON(429, gin.H{"error": "Too many unsaved sessions; save your recording first"})
		return
	}
	if h.liveSession != nil && !h.liveSession.Finished && time.Since(h.liveSession.Touched) < 90*time.Second {
		c.JSON(409, gin.H{"error": "Another realtime session is active"})
		return
	}
	if h.liveSession != nil && !h.liveSession.Finished && h.liveSession.SavedID != "" {
		h.liveSession.Finished = true
		if err := h.persistLive(c.Request.Context(), h.liveSession, h.liveSession.Result, models.StatusFailed, "Realtime recording interrupted; saved audio and text retained"); err != nil {
			h.liveSession.Finished = false
			c.JSON(503, gin.H{"error": "Failed to retain expired recording"})
			return
		}
	}
	if !h.taskQueue.ReserveRealtime() {
		c.JSON(409, gin.H{"error": "GPU is busy with a transcription task; retry when it finishes"})
		return
	}
	// Loading can exceed the normal 90-second lease. Keep ordinary uploads
	// excluded throughout startup, including when the browser disconnects.
	stopRenew, renewDone := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(renewDone)
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				h.taskQueue.RenewRealtime()
			case <-stopRenew:
				return
			}
		}
	}()
	code, data, err := liveCall(c, "/sessions", nil)
	close(stopRenew)
	<-renewDone
	if err != nil || code != 200 {
		h.taskQueue.ReleaseRealtime()
		c.JSON(503, gin.H{"error": "Realtime models are unavailable or still loading"})
		return
	}
	var result struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(data, &result) != nil || result.ID == "" {
		h.taskQueue.ReleaseRealtime()
		c.JSON(503, gin.H{"error": "Invalid session response"})
		return
	}
	h.liveSession = &liveSession{ID: result.ID, Owner: c.GetUint("user_id"), Touched: time.Now()}
	if c.Query("autosave") == "1" {
		if err := h.createLiveProject(c, h.liveSession, data); err != nil {
			_, _, _ = liveCall(c, "/sessions/"+result.ID+"/cancel", nil)
			h.liveSession.Finished = true
			h.taskQueue.ReleaseRealtime()
			c.JSON(503, gin.H{"error": err.Error()})
			return
		}
		h.expireLiveProject(h.liveSession)
		data = h.liveSession.Result
	}
	c.Data(200, "application/json", data)
}

func (h *Handler) UpdateRealtime(c *gin.Context) {
	// Read the bounded network body before taking the shared session lock.
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 64000))
	if err != nil {
		c.JSON(413, gin.H{"error": "Audio chunk too large"})
		return
	}
	h.liveMu.Lock()
	defer h.liveMu.Unlock()
	s := h.liveSession
	if s == nil || s.ID != c.Param("id") || s.Owner != c.GetUint("user_id") || time.Since(s.Touched) > 90*time.Second {
		c.JSON(404, gin.H{"error": "Realtime session expired or not found"})
		return
	}
	action := c.Param("action")
	if action != "chunk" && action != "finish" && action != "cancel" && action != "pause" && action != "heartbeat" && action != "result" {
		c.JSON(400, gin.H{"error": "Unknown action"})
		return
	}
	if s.Finished {
		if (action == "finish" || action == "result") && len(s.Result) != 0 {
			s.Touched = time.Now()
			c.Data(200, "application/json", s.Result)
			return
		}
		if action == "cancel" {
			c.JSON(200, gin.H{"cancelled": true})
			return
		}
		c.JSON(409, gin.H{"error": "Session already finished"})
		return
	}
	// Old pages send cancel immediately after their single finish response.
	// Once finishing was requested, cancellation must not discard its outcome.
	if action == "finish" {
		s.FinishRequested = true
	}
	if action == "cancel" && s.FinishRequested {
		action = "finish"
	}
	query := ""
	if action == "chunk" {
		query = "?sequence=" + url.QueryEscape(c.Query("sequence"))
	}
	if s.SavedID != "" && action == "chunk" {
		if err := h.appendLiveAudio(c, s, body); err != nil {
			c.JSON(409, gin.H{"error": err.Error()})
			return
		}
	}
	h.taskQueue.RenewRealtime()
	code, data, err := liveCall(c, "/sessions/"+s.ID+"/"+action+query, body)
	if err != nil {
		c.JSON(503, gin.H{"error": err.Error()})
		return
	}
	// Legacy clients expect finish to return the final snapshot. New clients opt
	// into polling; the model service itself remains asynchronous in both cases.
	deadline := time.Now().Add(50 * time.Second)
	for action == "finish" && c.Query("async") != "1" && code == 200 && err == nil {
		var progress struct {
			Finished *bool `json:"finished"`
		}
		if json.Unmarshal(data, &progress) != nil || progress.Finished == nil || *progress.Finished {
			break
		}
		if time.Now().After(deadline) {
			c.JSON(503, gin.H{"error": "Final processing is still running; retry finish"})
			return
		}
		select {
		case <-c.Request.Context().Done():
			return
		case <-time.After(250 * time.Millisecond):
		}
		s.Touched = time.Now()
		h.taskQueue.RenewRealtime()
		code, data, err = liveCall(c, "/sessions/"+s.ID+"/finish", nil)
	}
	if err != nil {
		c.JSON(503, gin.H{"error": err.Error()})
		return
	}
	if code == 200 {
		// Keep admission until background inference/alignment confirms completion.
		finishComplete := action == "finish"
		if finishComplete {
			var progress struct {
				Finished *bool `json:"finished"`
			}
			if json.Unmarshal(data, &progress) == nil && progress.Finished != nil {
				finishComplete = *progress.Finished
			}
		}
		if s.SavedID != "" {
			status := models.StatusProcessing
			if finishComplete {
				s.Finished = true
				status = models.StatusCompleted
			}
			if action == "cancel" {
				s.Finished = true
				status = models.StatusFailed
				var retained map[string]json.RawMessage
				if json.Unmarshal(data, &retained) != nil || retained["text"] == nil {
					data = s.Result // Legacy model services only return cancelled:true.
				}
			}
			message := ""
			if action == "cancel" {
				message = "Realtime recording interrupted; saved audio and text retained"
			}
			if err := h.persistLive(c.Request.Context(), s, data, status, message); err != nil {
				s.Finished = false
				c.JSON(503, gin.H{"error": "Audio retained but transcript checkpoint failed; retry"})
				return
			}
			data = s.Result
		}
		s.Touched = time.Now()
		if finishComplete || action == "cancel" {
			s.Finished = true
			if action == "finish" {
				s.Result = append(json.RawMessage(nil), data...)
				if h.liveFinished == nil {
					h.liveFinished = make(map[string]*liveSession)
				}
				for id, old := range h.liveFinished {
					if time.Since(old.Touched) > 30*time.Minute {
						delete(h.liveFinished, id)
					}
				}
				h.liveFinished[s.ID] = s
			}
			h.taskQueue.ReleaseRealtime()
		}
	}
	c.Data(code, "application/json", data)
}

func (h *Handler) SaveRealtime(c *gin.Context) {
	identifier := c.PostForm("session_id")
	header, err := c.FormFile("audio")
	if err != nil {
		c.JSON(400, gin.H{"error": "Recording is required"})
		return
	}
	h.liveMu.Lock()
	defer h.liveMu.Unlock()
	s := h.liveFinished[identifier]
	if s == nil || s.Owner != c.GetUint("user_id") || s.ID != identifier || !s.Finished || len(s.Result) == 0 {
		c.JSON(409, gin.H{"error": "Finish the realtime session before saving"})
		return
	}
	if s.SavedID != "" {
		c.JSON(200, gin.H{"id": s.SavedID})
		return
	}
	path, err := h.fileService.SaveUpload(header, h.config.UploadDir)
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to save recording"})
		return
	}
	id := filepath.Base(path)
	id = id[:len(id)-len(filepath.Ext(id))]
	transcript := string(s.Result)
	title := c.PostForm("title")
	if title == "" {
		title = "Live recording " + time.Now().Format(time.RFC3339)
	}
	job := models.TranscriptionJob{ID: id, OwnerID: s.Owner, AudioPath: path, AudioBytes: header.Size, Title: &title,
		Status: models.StatusCompleted, Diarization: true, Transcript: &transcript}
	job.Parameters.ModelFamily = "funasr"
	job.Parameters.Model = "Qwen/Qwen3-ASR-1.7B"
	if err := h.jobRepo.Create(c.Request.Context(), &job); err != nil {
		_ = h.fileService.RemoveFile(path)
		c.JSON(500, gin.H{"error": "Failed to save realtime transcript"})
		return
	}
	s.SavedID = id
	c.JSON(200, job)
}
