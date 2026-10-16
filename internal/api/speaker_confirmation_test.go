package api

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"net/http/httptest"
	"scriberr/internal/models"
	"scriberr/internal/repository"
	"testing"
)

func TestSpeakerConfirmationForAllRecordingModes(t *testing.T) {
	db := regressionDB(t)
	if err := db.AutoMigrate(&models.SpeakerMapping{}); err != nil {
		t.Fatal(err)
	}
	jobs := repository.NewJobRepository(db)
	mappings := repository.NewSpeakerMappingRepository(db)
	h := &Handler{jobRepo: jobs, speakerMappingRepo: mappings}
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("user_id", uint(1))
		c.Request = c.Request.WithContext(models.WithRequestOwner(c.Request.Context(), 1))
	})
	router.Use(h.ResourceAccess())
	router.POST("/api/v1/transcription/:id/speakers", h.UpdateSpeakerMappings)
	router.GET("/api/v1/transcription/:id/speakers", h.GetSpeakerMappings)
	for _, mode := range []string{"realtime", "transcribe", "topic"} {
		job := &models.TranscriptionJob{ID: mode, OwnerID: 1, Status: models.StatusCompleted, Diarization: true}
		job.Parameters.Task = mode
		job.Parameters.TopicMode = mode == "topic"
		if mode == "realtime" {
			job.Status = models.StatusProcessing
		}
		if err := jobs.Create(context.Background(), job); err != nil {
			t.Fatal(err)
		}
		call := func(name string) *httptest.ResponseRecorder {
			request := SpeakerMappingsUpdateRequest{Mappings: []SpeakerMappingRequest{{OriginalSpeaker: "speaker_0", CustomName: "Alice", PersonID: "meeting:fixture"}, {OriginalSpeaker: "speaker_1", CustomName: name, PersonID: "meeting:fixture"}}}
			body, _ := json.Marshal(request)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/transcription/"+mode+"/speakers", bytes.NewReader(body)))
			return w
		}
		if w := call("Alice"); w.Code != 200 {
			t.Fatalf("%s %d %s", mode, w.Code, w.Body.String())
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/transcription/"+mode+"/speakers", nil))
		var saved []SpeakerMappingResponse
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &saved) != nil || len(saved) != 2 || saved[0].PersonID != "meeting:fixture" {
			t.Fatal("manual confirmation did not survive reloading")
		}
		if w := call("Bob"); w.Code != 400 {
			t.Fatal("conflicting names for same person accepted")
		}
		savedRows, _ := mappings.ListByJob(context.Background(), mode)
		if len(savedRows) != 2 || savedRows[1].CustomName != "Alice" {
			t.Fatal("rejected save replaced previous mappings")
		}
		got, _ := jobs.FindByID(context.Background(), mode)
		if got.Status != job.Status {
			t.Fatal("confirmation changed transcription state")
		}
	}
}
