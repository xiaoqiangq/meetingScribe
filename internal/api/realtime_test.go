package api

import (
	"bytes"
	"context"
	"github.com/gin-gonic/gin"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"scriberr/internal/config"
	"scriberr/internal/models"
	"scriberr/internal/queue"
	"scriberr/internal/repository"
	"scriberr/internal/service"
	"strings"
	"testing"
	"time"
)

func TestRealtimeURLRejectsNonLoopback(t *testing.T) {
	for _, value := range []string{"", "http://example.com", "https://127.0.0.1", "http://user:pass@localhost", "http://127.0.0.1/path", "http://127.0.0.1?x=1"} {
		t.Setenv("MEETINGSCRIBE_REALTIME_URL", value)
		if _, err := realtimeURL(); err == nil {
			t.Fatalf("accepted unsafe service URL: %q", value)
		}
	}
}

type liveTestFiles struct {
	service.FileService
	saves int
}

func (f *liveTestFiles) SaveUpload(_ *multipart.FileHeader, _ string) (string, error) {
	f.saves++
	return "test-live-id.webm", nil
}

type liveTestJobs struct {
	repository.JobRepository
	saved *models.TranscriptionJob
}

func (r *liveTestJobs) Create(_ context.Context, j *models.TranscriptionJob) error {
	r.saved = j
	return nil
}

func TestRealtimeSaveUsesServerResultAndDoesNotRequeue(t *testing.T) {
	files, jobs := &liveTestFiles{}, &liveTestJobs{}
	trusted := `{"text":"server transcript","segments":[]}`
	h := &Handler{config: &config.Config{}, fileService: files, jobRepo: jobs,
		liveFinished: map[string]*liveSession{"live-id": {ID: "live-id", Owner: 1, Finished: true, Result: []byte(trusted)}}}
	router := gin.New()
	owner := uint(2)
	router.Use(func(c *gin.Context) { c.Set("user_id", owner) })
	router.POST("/upload-live", h.SaveRealtime)
	invoke := func() int {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		_ = writer.WriteField("session_id", "live-id")
		_ = writer.WriteField("transcript", `{"text":"untrusted client transcript"}`)
		part, _ := writer.CreateFormFile("audio", "recording.webm")
		_, _ = part.Write([]byte("fixture"))
		_ = writer.Close()
		request := httptest.NewRequest("POST", "/upload-live", body)
		request.Header.Set("Content-Type", writer.FormDataContentType())
		w := httptest.NewRecorder()
		router.ServeHTTP(w, request)
		return w.Code
	}
	if invoke() != 409 || files.saves != 0 {
		t.Fatal("another user must not save private transcript")
	}
	owner = 1
	if invoke() != 200 {
		t.Fatal("owner could not save")
	}
	if jobs.saved.Status != models.StatusCompleted || jobs.saved.OwnerID != 1 || *jobs.saved.Transcript != trusted {
		t.Fatal("saved result or ownership was altered")
	}
	if invoke() != 200 || files.saves != 1 {
		t.Fatal("save retry created a duplicate recording")
	}
}

func TestRealtimeSessionOwnershipAndRetry(t *testing.T) {
	gin.SetMode(gin.TestMode)
	calls := 0
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"sequence":1,"text":"test"}`))
	}))
	defer backend.Close()
	t.Setenv("MEETINGSCRIBE_REALTIME_URL", backend.URL)
	h := &Handler{taskQueue: queue.NewTaskQueue(1, nil, nil), liveSession: &liveSession{ID: "live-id", Owner: 1, Touched: time.Now()}}
	router := gin.New()
	owner := uint(2)
	router.Use(func(c *gin.Context) { c.Set("user_id", owner) })
	router.POST("/sessions/:id/:action", h.UpdateRealtime)
	invoke := func(path string, size int) int {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("POST", path, bytes.NewReader(make([]byte, size))))
		return w.Code
	}
	if got := invoke("/sessions/live-id/chunk?sequence=0", 32000); got != 404 {
		t.Fatalf("other owner got %d", got)
	}
	if calls != 0 {
		t.Fatal("private audio must not reach model service for another owner")
	}
	owner = 1
	if got := invoke("/sessions/live-id/chunk?sequence=0", 64002); got != 413 {
		t.Fatalf("oversized chunk got %d", got)
	}
	if got := invoke("/sessions/live-id/chunk?sequence=0", 32000); got != 200 {
		t.Fatalf("own chunk got %d", got)
	}
	if got := invoke("/sessions/live-id/finish", 0); got != 200 {
		t.Fatalf("finish got %d", got)
	}
	if len(h.liveFinished["live-id"].Result) == 0 {
		t.Fatal("final result must survive a subsequent live session")
	}
	if got := invoke("/sessions/live-id/finish", 0); got != 200 {
		t.Fatalf("finish retry must return stored result: %d", got)
	}
	if got := invoke("/sessions/live-id/chunk?sequence=1", 32000); got != 409 {
		t.Fatalf("finished session accepted audio: %d", got)
	}
}

func TestRealtimeBackgroundFinishRetainsAdmissionAndAllowsOwnedPolling(t *testing.T) {
	gin.SetMode(gin.TestMode)
	finished := false
	calls := 0
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		if finished {
			_, _ = w.Write([]byte(`{"finished":true,"text":"final","sequence":2}`))
		} else {
			_, _ = w.Write([]byte(`{"finished":false,"text":"confirmed","sequence":1}`))
		}
	}))
	defer backend.Close()
	t.Setenv("MEETINGSCRIBE_REALTIME_URL", backend.URL)
	q := queue.NewTaskQueue(1, nil, nil)
	if !q.ReserveRealtime() {
		t.Fatal("could not reserve realtime admission")
	}
	h := &Handler{taskQueue: q, liveSession: &liveSession{ID: "live-id", Owner: 1, Touched: time.Now()}}
	owner := uint(1)
	router := gin.New()
	router.Use(func(c *gin.Context) { c.Set("user_id", owner) })
	router.POST("/sessions/:id/:action", h.UpdateRealtime)
	invoke := func(action string) int {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("POST", "/sessions/live-id/"+action+"?async=1", nil))
		return w.Code
	}
	if invoke("finish") != 200 || h.liveSession.Finished {
		t.Fatal("finish acknowledgement must not mark the project complete")
	}
	if q.ReserveRealtime() {
		t.Fatal("GPU admission released before inference finished")
	}
	if invoke("result") != 200 {
		t.Fatal("owner cannot poll live results")
	}
	owner = 2
	before := calls
	if invoke("result") != 404 || calls != before {
		t.Fatal("another owner could poll private results")
	}
	owner = 1
	finished = true
	if invoke("finish") != 200 || !h.liveSession.Finished {
		t.Fatal("completed inference did not finalize the project")
	}
	if !q.ReserveRealtime() {
		t.Fatal("GPU admission not released after completion")
	}
	before = calls
	if invoke("result") != 200 || calls != before {
		t.Fatal("finished polling must return the retained result")
	}
}

func TestRealtimeLegacyFinishWaitsAndCleanupCannotMarkFailure(t *testing.T) {
	gin.SetMode(gin.TestMode)
	calls := 0
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if strings.HasSuffix(r.URL.Path, "/cancel") {
			t.Error("finish cleanup reached cancel on model service")
		}
		w.Header().Set("Content-Type", "application/json")
		if calls == 1 {
			_, _ = w.Write([]byte(`{"finished":false,"text":"draft checkpoint"}`))
		} else {
			_, _ = w.Write([]byte(`{"finished":true,"text":"final checkpoint"}`))
		}
	}))
	defer backend.Close()
	t.Setenv("MEETINGSCRIBE_REALTIME_URL", backend.URL)
	q := queue.NewTaskQueue(1, nil, nil)
	q.ReserveRealtime()
	h := &Handler{taskQueue: q, liveSession: &liveSession{ID: "live-id", Owner: 1, Touched: time.Now()}}
	router := gin.New()
	router.Use(func(c *gin.Context) { c.Set("user_id", uint(1)) })
	router.POST("/sessions/:id/:action", h.UpdateRealtime)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest("POST", "/sessions/live-id/finish", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"finished":true`) || !h.liveSession.Finished {
		t.Fatalf("legacy client received unfinished result: %s", w.Body.String())
	}
	w = httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest("POST", "/sessions/live-id/cancel", nil))
	if w.Code != 200 || calls != 2 {
		t.Fatal("legacy cleanup altered completed session")
	}
}

func TestRealtimeCancelAfterAsyncFinishCompletesInsteadOfAbandoning(t *testing.T) {
	gin.SetMode(gin.TestMode)
	calls := 0
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/cancel") {
			t.Error("pending finish must not be abandoned")
		}
		calls++
		w.Header().Set("Content-Type", "application/json")
		if calls == 1 {
			_, _ = w.Write([]byte(`{"finished":false,"text":"checkpoint"}`))
		} else {
			_, _ = w.Write([]byte(`{"finished":true,"text":"final"}`))
		}
	}))
	defer backend.Close()
	t.Setenv("MEETINGSCRIBE_REALTIME_URL", backend.URL)
	q := queue.NewTaskQueue(1, nil, nil)
	q.ReserveRealtime()
	h := &Handler{taskQueue: q, liveSession: &liveSession{ID: "live-id", Owner: 1, Touched: time.Now()}}
	router := gin.New()
	router.Use(func(c *gin.Context) { c.Set("user_id", uint(1)) })
	router.POST("/sessions/:id/:action", h.UpdateRealtime)
	for _, action := range []string{"finish?async=1", "cancel"} {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("POST", "/sessions/live-id/"+action, nil))
		if w.Code != 200 {
			t.Fatalf("%s returned %d", action, w.Code)
		}
	}
	if !h.liveSession.Finished || string(h.liveSession.Result) != `{"finished":true,"text":"final"}` {
		t.Fatal("final snapshot not retained")
	}
}
