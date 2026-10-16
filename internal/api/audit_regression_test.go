package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"scriberr/internal/processing"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"scriberr/internal/config"
	"scriberr/internal/database"
	"scriberr/internal/models"
	"scriberr/internal/queue"
	"scriberr/internal/repository"
	"scriberr/internal/service"
)

func regressionDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	conn, _ := db.DB()
	conn.SetMaxOpenConns(1)
	old := database.DB
	database.DB = db
	t.Cleanup(func() { database.DB = old; conn.Close() })
	if err = db.AutoMigrate(&models.User{}, &models.TranscriptionJob{}, &models.MultiTrackFile{}); err != nil {
		t.Fatal(err)
	}
	if err = db.Create(&models.User{ID: 1, Username: "fixture", Password: "test", AudioQuotaBytes: 1 << 30}).Error; err != nil {
		t.Fatal(err)
	}
	return db
}

func TestAuditRetranscriptionPreservesResultsAndAdmission(t *testing.T) {
	db := regressionDB(t)
	repo := repository.NewJobRepository(db)
	text, summary := `{"text":"confirmed text","segments":[]}`, "meeting notes"
	j := &models.TranscriptionJob{ID: "fixture", OwnerID: 1, Status: models.StatusCompleted, Transcript: &text, Summary: &summary}
	if err := repo.Create(context.Background(), j); err != nil {
		t.Fatal(err)
	}
	q := queue.NewTaskQueue(1, nil, repo)
	q.ReserveRealtime()
	h := &Handler{jobRepo: repo, taskQueue: q}
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set("role", "admin"); c.Set("auth_type", "jwt") })
	r.POST("/:id/start", h.StartTranscription)
	call := func() *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("POST", "/fixture/start", bytes.NewBufferString(`{"model":"large-v3","batch_size":0}`)))
		return w
	}
	if w := call(); w.Code != 429 {
		t.Fatal(w.Body.String())
	}
	got, _ := repo.FindByID(context.Background(), j.ID)
	if got.Status != models.StatusCompleted || got.Transcript == nil || *got.Transcript != text || got.Summary == nil {
		t.Fatal("rejected retry changed old results")
	}
	q.ReleaseRealtime()
	if w := call(); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	got, _ = repo.FindByID(context.Background(), j.ID)
	if got.Status != models.StatusPending || got.Transcript == nil || got.Summary == nil || got.Parameters.Model != "large-v3" || got.Parameters.BatchSize != 0 {
		t.Fatalf("preparation changed results or lost parameters: %+v", got)
	}
	getRouter := gin.New()
	getRouter.GET("/:id/transcript", h.GetTranscript)
	get := httptest.NewRecorder()
	getRouter.ServeHTTP(get, httptest.NewRequest("GET", "/fixture/transcript", nil))
	var result map[string]interface{}
	json.Unmarshal(get.Body.Bytes(), &result)
	if get.Code != 200 || result["available"] != true {
		t.Fatal("retained transcript hidden while retry is queued")
	}
	if w := call(); w.Code != 400 {
		t.Fatal("duplicate start accepted")
	}
}

type finishDuringRename struct{ repository.JobRepository }

func (r *finishDuringRename) FindByID(ctx context.Context, id interface{}) (*models.TranscriptionJob, error) {
	old, err := r.JobRepository.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if err = r.UpdateTranscript(ctx, id.(string), "new result"); err != nil {
		return nil, err
	}
	if err = r.UpdateStatus(ctx, id.(string), models.StatusCompleted); err != nil {
		return nil, err
	}
	return old, nil
}
func TestAuditRenameDoesNotOverwriteConcurrentCompletion(t *testing.T) {
	db := regressionDB(t)
	repo := repository.NewJobRepository(db)
	repo.Create(context.Background(), &models.TranscriptionJob{ID: "fixture", OwnerID: 1, Status: models.StatusProcessing})
	h := &Handler{jobRepo: &finishDuringRename{repo}}
	r := gin.New()
	r.PUT("/:id/title", h.UpdateTranscriptionTitle)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("PUT", "/fixture/title", bytes.NewBufferString(`{"title":"renamed"}`)))
	got, _ := repo.FindByID(context.Background(), "fixture")
	if w.Code != 200 || got.Status != models.StatusCompleted || got.Transcript == nil || *got.Transcript != "new result" || *got.Title != "renamed" {
		t.Fatal("rename overwrote inference checkpoint")
	}
}

func TestAuditCLICallbackBoundary(t *testing.T) {
	for _, raw := range []string{"https://example.invalid/capture", "http://localhost.evil:1234", "http://127.0.0.1:1234@evil.invalid/", "//localhost:1234", "javascript:alert(1)", "http://localhost", "http://localhost:80", "http://localhost:70000", "http://localhost:1234/#fragment", "http://localhost:1234/?token=preseed"} {
		if _, err := validateCLICallback(raw); err == nil {
			t.Fatalf("unsafe callback accepted: %s", raw)
		}
		// Validation happens before loading an account or minting a credential.
		h := &Handler{}
		r := gin.New()
		r.POST("/authorize", h.ConfirmCLIAuthorization)
		body, _ := json.Marshal(AuthorizeCLIRequest{CallbackURL: raw})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("POST", "/authorize", bytes.NewReader(body)))
		if w.Code != 400 {
			t.Fatalf("callback returned %d", w.Code)
		}
	}
	for _, raw := range []string{"http://localhost:12345", "http://127.0.0.1:54321/callback?state=nonce", "http://[::1]:12345/"} {
		if _, err := validateCLICallback(raw); err != nil {
			t.Fatal(err)
		}
	}
}

func TestAuditColdDisconnectWaitsForWorkerReset(t *testing.T) {
	entered, ready, resetEntered, resetDone := make(chan struct{}), make(chan struct{}), make(chan struct{}), make(chan struct{})
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/sessions":
			close(entered)
			<-ready
			io.WriteString(w, `{"id":"orphan"}`)
		case "/reset":
			close(resetEntered)
			<-resetDone
			io.WriteString(w, `{"reset":true}`)
		}
	}))
	defer backend.Close()
	// Always unblock fixtures before closing the HTTP server, including failures.
	defer func() {
		select {
		case <-ready:
		default:
			close(ready)
		}
		select {
		case <-resetDone:
		default:
			close(resetDone)
		}
	}()
	t.Setenv("MEETINGSCRIBE_REALTIME_URL", backend.URL)
	q := queue.NewTaskQueue(1, nil, nil)
	h := &Handler{taskQueue: q}
	r := gin.New()
	r.POST("/sessions", h.StartRealtime)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() {
		r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("POST", "/sessions", nil).WithContext(ctx))
		close(done)
	}()
	wait := func(ch <-chan struct{}) {
		t.Helper()
		select {
		case <-ch:
		case <-time.After(5 * time.Second):
			t.Fatal("lifecycle timed out")
		}
	}
	wait(entered)
	cancel()
	if err := q.EnqueueJob("offline"); err == nil {
		t.Fatal("admitted during loading")
	}
	close(ready)
	wait(done)
	wait(resetEntered)
	if err := q.EnqueueJob("offline"); err == nil {
		t.Fatal("admitted before worker reset acknowledgement")
	}
	close(resetDone)
	deadline := time.Now().Add(5 * time.Second)
	for {
		if q.ReserveRealtime() {
			q.ReleaseRealtime()
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("lease not released after reset")
		}
		time.Sleep(time.Millisecond)
	}
	if err := q.EnqueueJob("offline"); err != nil {
		t.Fatal(err)
	}
}

func TestAuditMultiTrackUploadContract(t *testing.T) {
	db := regressionDB(t)
	repo := repository.NewJobRepository(db)
	root, err := os.MkdirTemp("", "meetingscribe-multitrack-regression-")
	if err != nil {
		t.Fatal(err)
	}
	h := &Handler{config: &config.Config{UploadDir: root}, jobRepo: repo, fileService: service.NewFileService()}
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", uint(1))
		c.Request = c.Request.WithContext(models.WithRequestOwner(c.Request.Context(), 1))
	})
	r.POST("/upload", h.UploadMultiTrack)
	for _, field := range []string{"files", "tracks"} {
		var body bytes.Buffer
		mw := multipart.NewWriter(&body)
		part, _ := mw.CreateFormFile(field, "alice.wav")
		part.Write([]byte("synthetic-audio"))
		part, _ = mw.CreateFormFile("aup", "meeting.aup")
		part.Write([]byte(`<project><wavetrack gain="1" pan="0"><waveclip offset="2.5"><import filename="alice.wav"/></waveclip></wavetrack></project>`))
		mw.Close()
		req := httptest.NewRequest("POST", "/upload", &body)
		req.Header.Set("Content-Type", mw.FormDataContentType())
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var job models.TranscriptionJob
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &job) != nil {
			t.Fatalf("%d %s", w.Code, w.Body.String())
		}
		if job.OwnerID != 1 || job.MultiTrackFolder == nil || job.AupFilePath == nil || len(job.MultiTrackFiles) != 1 || job.MultiTrackFiles[0].Offset != 2.5 {
			t.Fatal("missing multitrack metadata")
		}
		stored, err := repo.FindByID(context.Background(), job.ID)
		if err != nil {
			t.Fatal(err)
		}
		if stored.AudioBytes <= int64(len("synthetic-audio")) {
			t.Fatal("AUP not accounted for")
		}
	}
}

func TestAuditRealtimeNinetyMinuteBoundary(t *testing.T) {
	db := regressionDB(t)
	repo := repository.NewJobRepository(db)
	f, err := os.CreateTemp("", "meetingscribe-90minute-*.wav")
	if err != nil {
		t.Fatal(err)
	}
	path := f.Name()
	defer os.Remove(path)
	size := int64(32000 * (5400 - 1))
	if err = f.Truncate(44 + size); err != nil {
		t.Fatal(err)
	}
	f.Close()
	s := &liveSession{ID: "live", Owner: 1, SavedID: "project", AudioPath: path, AudioSize: size, Result: []byte(`{"text":"retained"}`)}
	repo.Create(context.Background(), &models.TranscriptionJob{ID: s.SavedID, OwnerID: 1, AudioPath: path, Status: models.StatusProcessing})
	h := &Handler{jobRepo: repo}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/?sequence=0", nil)
	if err = h.appendLiveAudio(c, s, make([]byte, 32000)); err != nil {
		t.Fatal(err)
	}
	if s.AudioSize != 32000*5400 {
		t.Fatal("last second lost")
	}
	c, _ = gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/?sequence=1", nil)
	if err = h.appendLiveAudio(c, s, make([]byte, 32000)); err == nil {
		t.Fatal("limit exceeded")
	}
	if info, err := os.Stat(filepath.Clean(path)); err != nil || info.Size() != 44+32000*5400 {
		t.Fatal("boundary rejection changed recording")
	}
}

func TestAuditMultiTrackMergeEndToEnd(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg unavailable")
	}
	db := regressionDB(t)
	repo := repository.NewJobRepository(db)
	root, err := os.MkdirTemp("", "meetingscribe-multitrack-merge-")
	if err != nil {
		t.Fatal(err)
	}
	h := &Handler{config: &config.Config{UploadDir: root}, jobRepo: repo, fileService: service.NewFileService(), multiTrackProcessor: processing.NewMultiTrackProcessor(db, repo)}
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("user_id", uint(1))
		c.Request = c.Request.WithContext(models.WithRequestOwner(c.Request.Context(), 1))
	})
	router.POST("/upload", h.UploadMultiTrack)
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	part, _ := mw.CreateFormFile("files", "alice.wav")
	part.Write(append(liveWAVHeader(3200), make([]byte, 3200)...))
	part, _ = mw.CreateFormFile("aup", "meeting.aup")
	part.Write([]byte(`<project><wavetrack gain="1" pan="0"><waveclip offset="0.2"><import filename="alice.wav"/></waveclip></wavetrack></project>`))
	mw.Close()
	req := httptest.NewRequest("POST", "/upload", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	var job models.TranscriptionJob
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &job) != nil {
		t.Fatalf("upload: %d %s", w.Code, w.Body.String())
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		got, err := repo.FindWithAssociations(context.Background(), job.ID)
		if err != nil {
			t.Fatal(err)
		}
		if got.MergeStatus == "failed" {
			t.Fatalf("merge failed: %v", got.MergeError)
		}
		if got.MergeStatus == "completed" {
			if got.MergedAudioPath == nil || got.AudioPath != *got.MergedAudioPath || got.MultiTrackFiles[0].Offset != .2 {
				t.Fatal("merge metadata mismatch")
			}
			if info, err := os.Stat(got.AudioPath); err != nil || info.Size() == 0 {
				t.Fatal("merged audio missing")
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("merge timed out")
		}
		time.Sleep(10 * time.Millisecond)
	}
}
