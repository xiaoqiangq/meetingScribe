package api

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"scriberr/internal/config"
	"scriberr/internal/database"
	"scriberr/internal/models"
	"scriberr/internal/queue"
	"scriberr/internal/repository"
	"strings"
	"testing"
)

func TestRealtimeDurableProject(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	conn, _ := db.DB()
	conn.SetMaxOpenConns(1)
	defer conn.Close()
	old := database.DB
	database.DB = db
	defer func() { database.DB = old }()
	if err = db.AutoMigrate(&models.User{}, &models.TranscriptionJob{}); err != nil {
		t.Fatal(err)
	}
	user := models.User{Username: "live-owner", Password: "test", AudioQuotaBytes: 1000000}
	db.Create(&user)
	// This directory is retained. Only the explicitly created ordinary recording
	// file is removed; no recursive test cleanup is used.
	dir, err := os.MkdirTemp("", "meetingscribe-live-test-")
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	failModel := false
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		if failModel {
			w.WriteHeader(503)
			io.WriteString(w, `{"error":"temporary failure"}`)
			return
		}
		io.WriteString(w, `{"id":"live-id","duration":1,"text":"confirmed speech","segments":[{"start":0,"end":1,"text":"confirmed speech","speaker":"speaker_0"}],"word_segments":[],"partial":{"text":""},"metadata":{}}`)
	}))
	defer backend.Close()
	t.Setenv("MEETINGSCRIBE_REALTIME_URL", backend.URL)
	h := &Handler{config: &config.Config{UploadDir: dir}, jobRepo: repository.NewJobRepository(db), taskQueue: queue.NewTaskQueue(1, nil, nil)}
	owner := user.ID
	router := gin.New()
	router.Use(func(c *gin.Context) { c.Set("user_id", owner) })
	router.POST("/sessions", h.StartRealtime)
	router.POST("/sessions/:id/:action", h.UpdateRealtime)
	router.GET("/jobs/:id/transcript", h.GetTranscript)
	invoke := func(path string, body []byte) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("POST", path, bytes.NewReader(body)))
		return w
	}
	start := invoke("/sessions?autosave=1", nil)
	if start.Code != 200 {
		t.Fatalf("start: %d %s", start.Code, start.Body.String())
	}
	var response struct {
		JobID string `json:"job_id"`
	}
	json.Unmarshal(start.Body.Bytes(), &response)
	if response.JobID == "" {
		t.Fatal("project missing")
	}
	path := h.liveSession.AudioPath
	defer os.Remove(path)
	job := func() models.TranscriptionJob {
		var j models.TranscriptionJob
		if e := db.First(&j, "id = ?", response.JobID).Error; e != nil {
			t.Fatal(e)
		}
		return j
	}
	verify := func(want int) {
		data, e := os.ReadFile(path)
		if e != nil {
			t.Fatal(e)
		}
		if len(data) != want+44 || int(binary.LittleEndian.Uint32(data[40:44])) != want || binary.LittleEndian.Uint32(data[24:28]) != 16000 {
			t.Fatalf("invalid saved WAV: %d", len(data))
		}
		if job().AudioBytes != int64(want+44) {
			t.Fatal("quota bytes mismatch")
		}
	}
	verify(0)
	pcm := make([]byte, 32000)
	pcm[0] = 42
	if w := invoke("/sessions/live-id/chunk?sequence=0", pcm); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	verify(32000)
	if w := invoke("/sessions/live-id/chunk?sequence=0", pcm); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	verify(32000)
	altered := append([]byte(nil), pcm...)
	altered[0] = 43
	n := calls
	if w := invoke("/sessions/live-id/chunk?sequence=0", altered); w.Code != 409 || calls != n {
		t.Fatal("changed retry accepted")
	}
	owner++
	if w := invoke("/sessions/live-id/chunk?sequence=1", pcm); w.Code != 404 || calls != n {
		t.Fatal("another owner accessed recording")
	}
	owner = user.ID
	db.Model(&user).Update("audio_quota_bytes", 32044)
	if w := invoke("/sessions/live-id/chunk?sequence=1", pcm); w.Code != 409 || calls != n {
		t.Fatal("quota bypass")
	}
	verify(32000)
	db.Model(&user).Update("audio_quota_bytes", 1000000)
	db.Model(&models.TranscriptionJob{}).Where("id = ?", response.JobID).Update("title", "user edited title")
	failModel = true
	if w := invoke("/sessions/live-id/chunk?sequence=1", pcm); w.Code != 503 {
		t.Fatal("expected model failure")
	}
	verify(64000)
	failModel = false
	if w := invoke("/sessions/live-id/chunk?sequence=1", pcm); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	verify(64000)
	get := httptest.NewRecorder()
	router.ServeHTTP(get, httptest.NewRequest("GET", "/jobs/"+response.JobID+"/transcript", nil))
	if !strings.Contains(get.Body.String(), `"available":true`) {
		t.Fatal("live transcript unavailable")
	}
	if w := invoke("/sessions/live-id/finish", nil); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	n = calls
	if w := invoke("/sessions/live-id/finish", nil); w.Code != 200 || calls != n {
		t.Fatal("finish retry reran model")
	}
	j := job()
	if j.Status != models.StatusCompleted || j.Title == nil || *j.Title != "user edited title" {
		t.Fatal("finish overwrote project edits")
	}
	verify(64000)
	var count int64
	db.Model(&models.TranscriptionJob{}).Count(&count)
	if count != 1 {
		t.Fatal("created duplicate projects")
	}
	// A separate interrupted session retains both its PCM and confirmed text.
	start = invoke("/sessions?autosave=1", nil)
	if start.Code != 200 {
		t.Fatal(start.Body.String())
	}
	secondPath := h.liveSession.AudioPath
	defer os.Remove(secondPath)
	if w := invoke("/sessions/live-id/chunk?sequence=0", pcm); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w := invoke("/sessions/live-id/cancel", nil); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var cancelled models.TranscriptionJob
	db.First(&cancelled, "id = ?", h.liveSession.SavedID)
	if cancelled.Status != models.StatusFailed || cancelled.AudioBytes != 32044 || cancelled.Transcript == nil || !strings.Contains(*cancelled.Transcript, "confirmed speech") {
		t.Fatal("interrupted recording lost saved data")
	}
}
