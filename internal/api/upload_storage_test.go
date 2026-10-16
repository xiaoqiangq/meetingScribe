package api

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"scriberr/internal/config"
	"scriberr/internal/database"
	"scriberr/internal/models"
	"scriberr/internal/repository"
	"scriberr/internal/service"
)

func TestAccountUploadAndPlayback(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	conn, _ := db.DB()
	defer conn.Close()
	conn.SetMaxOpenConns(1)
	old := database.DB
	database.DB = db
	defer func() { database.DB = old }()
	if err := db.AutoMigrate(&models.User{}, &models.TranscriptionJob{}); err != nil {
		t.Fatal(err)
	}
	users := []models.User{{Username: "alice", Password: "test"}, {Username: "bob", Password: "test"}}
	for i := range users {
		if err := db.Create(&users[i]).Error; err != nil {
			t.Fatal(err)
		}
	}
	root, err := os.MkdirTemp("", "meetingscribe-account-upload-")
	if err != nil {
		t.Fatal(err)
	}
	h := &Handler{config: &config.Config{UploadDir: root}, fileService: service.NewFileService(), jobRepo: repository.NewJobRepository(db), userService: service.NewUserService(repository.NewUserRepository(db), nil)}
	router := gin.New()
	owner := users[0].ID
	router.Use(func(c *gin.Context) {
		c.Set("user_id", owner)
		c.Request = c.Request.WithContext(models.WithRequestOwner(c.Request.Context(), owner))
	})
	router.POST("/upload", h.UploadAudio)
	router.GET("/audio/:id", func(c *gin.Context) {
		if h.requireOwnedJob(c, c.Param("id")) {
			h.GetAudioFile(c)
		}
	})
	var ids []string
	for _, u := range users {
		owner = u.ID
		body := &bytes.Buffer{}
		form := multipart.NewWriter(body)
		part, _ := form.CreateFormFile("audio", "meeting.wav")
		part.Write([]byte("test-audio"))
		form.Close()
		req := httptest.NewRequest("POST", "/upload", body)
		req.Header.Set("Content-Type", form.FormDataContentType())
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != 200 {
			t.Fatalf("upload: %d %s", w.Code, w.Body.String())
		}
		var job models.TranscriptionJob
		if err := json.Unmarshal(w.Body.Bytes(), &job); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, job.ID)
		if job.OwnerID != u.ID || filepath.Dir(job.AudioPath) != filepath.Join(root, u.Username) {
			t.Fatalf("wrong namespace: %+v", job)
		}
		defer os.Remove(job.AudioPath)
		play := httptest.NewRecorder()
		router.ServeHTTP(play, httptest.NewRequest("GET", "/audio/"+job.ID, nil))
		if play.Code != 200 || play.Body.String() != "test-audio" {
			t.Fatalf("playback: %d", play.Code)
		}
	}
	owner = users[1].ID
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest("GET", "/audio/"+ids[0], nil))
	if w.Code != 404 {
		t.Fatal("other user's audio accessible")
	}
	legacyPath := filepath.Join(root, "legacy.wav")
	if err := os.WriteFile(legacyPath, []byte("legacy"), 0600); err != nil {
		t.Fatal(err)
	}
	defer os.Remove(legacyPath)
	legacy := models.TranscriptionJob{ID: "legacy", OwnerID: owner, AudioPath: legacyPath}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	w = httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest("GET", "/audio/legacy", nil))
	if w.Code != 200 || w.Body.String() != "legacy" {
		t.Fatal("legacy path playback broken")
	}
}
