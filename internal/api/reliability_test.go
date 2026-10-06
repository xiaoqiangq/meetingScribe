package api

import (
	"context"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"net/http/httptest"
	"scriberr/internal/llm"
	"scriberr/internal/models"
	"scriberr/internal/repository"
	"strings"
	"testing"
	"time"
)

type failingStream struct{ fail bool }

func (f failingStream) GetModels(context.Context) ([]string, error)           { return nil, nil }
func (f failingStream) GetContextWindow(context.Context, string) (int, error) { return 0, nil }
func (f failingStream) ChatCompletion(context.Context, string, []llm.ChatMessage, float64) (*llm.ChatResponse, error) {
	return nil, errors.New("unused")
}
func (f failingStream) ChatCompletionStream(context.Context, string, []llm.ChatMessage, float64) (<-chan string, <-chan error) {
	chunks := make(chan string, 1)
	failures := make(chan error, 1)
	chunks <- "partial words"
	close(chunks)
	if f.fail {
		failures <- errors.New("upstream disconnected")
	}
	close(failures)
	return chunks, failures
}
func TestSummaryFailureNeverReplacesCompletedSummary(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	defer sqlDB.Close()
	if err = db.AutoMigrate(&models.TranscriptionJob{}, &models.Summary{}, &models.SummaryTemplate{}); err != nil {
		t.Fatal(err)
	}
	h := &Handler{summaryRepo: repository.NewSummaryRepository(db), jobRepo: repository.NewJobRepository(db)}
	db.Create(&models.TranscriptionJob{ID: "meeting", AudioPath: "audio"})
	for _, fail := range []bool{false, true} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("POST", "/", strings.NewReader(""))
		h.processSummarization(c, SummarizeRequest{TranscriptionID: "meeting", Model: "mock"}, failingStream{fail: fail}, nil, time.Now())
		if fail && (!strings.Contains(w.Body.String(), `"status":"partial"`) || strings.Contains(w.Body.String(), `"type":"done"`)) {
			t.Fatal(w.Body.String())
		}
		if !fail && !strings.Contains(w.Body.String(), `"type":"done"`) {
			t.Fatal("no completion event")
		}
	}
	var rows []models.Summary
	db.Order("created_at DESC").Find(&rows)
	if len(rows) != 2 || rows[0].Status != "partial" || rows[1].Status != "completed" {
		t.Fatalf("invalid persisted states: %+v", rows)
	}
	latest, err := h.summaryRepo.GetLatestSummary(context.Background(), "meeting")
	if err != nil || latest.Status != "completed" {
		t.Fatal("partial replaced latest complete")
	}
}
func TestLoginAndUploadLimits(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("LOGIN_REQUESTS_PER_MINUTE", "2")
	t.Setenv("MAX_UPLOAD_BYTES", "8")
	r := gin.New()
	r.POST("/login", loginLimiter(), func(c *gin.Context) { c.Status(200) })
	for i := 0; i < 3; i++ {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("POST", "/login", nil))
		if i == 2 && w.Code != 429 {
			t.Fatal("login not limited")
		}
	}
	r.POST("/upload", func(c *gin.Context) { c.Set("user_id", uint(7)); c.Next() }, requestLimits(), func(c *gin.Context) { c.Status(200) })
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("POST", "/upload", strings.NewReader("123456789")))
	if w.Code != 413 {
		t.Fatalf("oversized upload accepted: %d", w.Code)
	}
}
