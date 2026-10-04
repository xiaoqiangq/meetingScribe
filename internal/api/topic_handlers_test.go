package api

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"net/http/httptest"
	"net/url"
	"scriberr/internal/models"
	"strings"
	"testing"
)

func TestTopicUploadValidation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, test := range []struct {
		mode, cuts string
		valid      bool
	}{{"", "", true}, {"short", "", true}, {"long", "[2580]", true}, {"long", "[2580,2580]", false}, {"long", "[]", false}, {"long", "null", false}, {"long", "bad", false}, {"other", "[2580]", false}} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Set("role", "admin")
		c.Set("auth_type", "jwt")
		form := url.Values{"upload_mode": {test.mode}, "topic_boundaries": {test.cuts}}
		c.Request = httptest.NewRequest(http.MethodPost, "/upload", strings.NewReader(form.Encode()))
		c.Request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		mode, _, err := parseTopicUpload(c)
		if (err == nil) != test.valid {
			t.Fatalf("%+v: %v", test, err)
		}
		if err == nil && mode != (test.mode == "long") {
			t.Fatal("incorrect upload mode")
		}
	}
}
func TestLongRecordingSurvivesProfileSelection(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Set("role", "admin")
	c.Set("auth_type", "jwt")
	c.Request = httptest.NewRequest(http.MethodPost, "/start", strings.NewReader(`{"model_family":"funasr","model":"Qwen/Qwen3-ASR-1.7B","device":"cuda","diarize":true,"diarize_model":"nvidia_sortformer","qwen_chunk_manager":true,"topic_mode":false}`))
	c.Request.Header.Set("Content-Type", "application/json")
	job := &models.TranscriptionJob{Parameters: models.WhisperXParams{TopicMode: true, TopicBoundaries: []float64{2580}}}
	params, err := (&Handler{}).getValidatedTranscriptionParams(c, job, "fixture")
	if err != nil {
		t.Fatal(err)
	}
	if !params.TopicMode || len(params.TopicBoundaries) != 1 || params.TopicBoundaries[0] != 2580 {
		t.Fatal("profile erased recording topics")
	}
}
