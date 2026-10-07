package api

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"net/http/httptest"
	"scriberr/internal/auth"
	"scriberr/internal/config"
	"scriberr/internal/database"
	"scriberr/internal/models"
	"scriberr/internal/repository"
	"strings"
	"testing"
)

func TestMultiuserAccessAndMigration(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	defer sqlDB.Close()
	previous := database.DB
	database.DB = db
	defer func() { database.DB = previous }()
	if err := db.AutoMigrate(&models.User{}, &models.TranscriptionJob{}, &models.APIKey{}, &models.RefreshToken{}, &models.Note{}, &models.ChatSession{}, &models.ChatMessage{}, &models.Summary{}, &models.SummaryTemplate{}, &models.SummarySetting{}, &models.TranscriptionProfile{}, &models.MultiTrackFile{}); err != nil {
		t.Fatal(err)
	}
	hash, _ := auth.HashPassword("test-password")
	admin := models.User{Username: "owner", Password: hash}
	a := models.User{Username: "alice", Password: hash}
	b := models.User{Username: "bob", Password: hash}
	for _, user := range []*models.User{&admin, &a, &b} {
		if err := db.Create(user).Error; err != nil {
			t.Fatal(err)
		}
	}
	old := models.TranscriptionJob{ID: "old", AudioPath: "old.wav", Title: strPtr("original meeting")}
	db.Create(&old)
	key := models.APIKey{Key: "legacy-key", Name: "old", IsActive: true}
	db.Create(&key)
	if err := database.MigrateOwnership(db); err != nil {
		t.Fatal(err)
	}
	db.First(&admin, admin.ID)
	db.First(&a, a.ID)
	db.First(&b, b.ID)
	db.First(&old, "id = ?", old.ID)
	db.First(&key, key.ID)
	if admin.Role != "admin" || a.Role != "user" || b.Role != "user" || old.OwnerID != admin.ID || key.OwnerID != admin.ID {
		t.Fatal("legacy migration failed")
	}
	jA := models.TranscriptionJob{ID: "alice-job", OwnerID: a.ID, AudioPath: "a.wav", Parameters: models.WhisperXParams{HfToken: strPtr("secret")}}
	jB := models.TranscriptionJob{ID: "bob-job", OwnerID: b.ID, AudioPath: "b.wav"}
	db.Create(&jA)
	db.Create(&jB)
	note := models.Note{ID: "bob-note", TranscriptionID: jB.ID}
	db.Create(&note)
	chat := models.ChatSession{ID: "bob-chat", TranscriptionID: jB.ID, JobID: jB.ID, Model: "test", Provider: "test", Title: "private"}
	db.Create(&chat)
	profile := models.TranscriptionProfile{ID: "approved", Name: "approved", Parameters: models.WhisperXParams{ModelFamily: "funasr", Model: "Qwen/Qwen3-ASR-1.7B", Device: "cuda", Diarize: true, DiarizeModel: "nvidia_sortformer", HfToken: strPtr("secret")}}
	db.Create(&profile)
	service := auth.NewAuthService("multiuser-test-secret")
	h := &Handler{config: &config.Config{}, authService: service, userRepo: repository.NewUserRepository(db), jobRepo: repository.NewJobRepository(db), noteRepo: repository.NewNoteRepository(db), chatRepo: repository.NewChatRepository(db), profileRepo: repository.NewProfileRepository(db), summaryRepo: repository.NewSummaryRepository(db)}
	router := SetupRoutes(h, service)
	tokens := map[string]string{}
	for _, u := range []models.User{admin, a, b} {
		token, _ := service.GenerateToken(&u)
		tokens[u.Username] = token
	}
	call := func(method, path, body, token string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w
	}
	own := call("GET", "/api/v1/auth/me/usage?user_id="+fmt.Sprint(b.ID), "", tokens[a.Username])
	var personal AccountWithUsage
	if own.Code != 200 || json.Unmarshal(own.Body.Bytes(), &personal) != nil || personal.ID != a.ID || personal.ProjectCount != 1 {
		t.Fatalf("personal usage exposed another user: %s", own.Body)
	}
	if w := call("PATCH", "/api/v1/admin/users/"+fmt.Sprint(a.ID), `{"audio_quota_bytes":1}`, tokens[a.Username]); w.Code != 403 {
		t.Fatal("ordinary user changed quota")
	}
	for _, test := range []struct {
		method, path, body string
		code               int
	}{
		{"GET", "/api/v1/transcription/bob-job", "", 404}, {"GET", "/api/v1/transcription/bob-job/audio", "", 404},
		{"GET", "/api/v1/transcription/bob-job/summary/history", "", 404}, {"GET", "/api/v1/transcription/bob-job/topic-recommendations", "", 404},
		{"GET", "/api/v1/transcription/bob-job/logs", "", 404}, {"POST", "/api/v1/transcription/bob-job/kill", "", 404},
		{"DELETE", "/api/v1/transcription/bob-job", "", 404}, {"GET", "/api/v1/notes/bob-note", "", 404},
		{"PUT", "/api/v1/notes/bob-note", `{"content":"overwrite"}`, 404}, {"DELETE", "/api/v1/notes/bob-note", "", 404},
		{"GET", "/api/v1/chat/sessions/bob-chat", "", 404}, {"POST", "/api/v1/chat/sessions/bob-chat/messages", `{"content":"read"}`, 404},
		{"DELETE", "/api/v1/chat/sessions/bob-chat", "", 404}, {"POST", "/api/v1/chat/sessions", `{"transcription_id":"bob-job","model":"test"}`, 404},
		{"POST", "/api/v1/summarize/", `{"transcription_id":"bob-job","model":"test","content":"overwrite"}`, 404},
		{"GET", "/api/v1/events/?job_id=bob-job", "", 404}, {"GET", "/api/v1/admin/users", "", 403},
		{"POST", "/api/v1/admin/users", `{}`, 403}, {"GET", "/api/v1/voiceprints/", "", 403}, {"GET", "/api/v1/voiceprints/samples/one.wav", "", 403},
		{"GET", "/api/v1/llm/config", "", 403}, {"POST", "/api/v1/profiles/", `{}`, 403}, {"PUT", "/api/v1/summaries/test", `{}`, 403},
		{"GET", "/api/v1/api-keys/", "", 403}, {"POST", "/api/v1/transcription/submit", `{}`, 403},
		{"GET", "/api/v1/transcription/alice-job", "", 200}, {"GET", "/api/v1/profiles/", "", 200},
	} {
		w := call(test.method, test.path, test.body, tokens[a.Username])
		if w.Code != test.code {
			t.Errorf("%s %s: got %d expected %d: %s", test.method, test.path, w.Code, test.code, w.Body.String())
		}
		if w.Code == 200 && strings.Contains(w.Body.String(), "secret") {
			t.Errorf("secret in %s", test.path)
		}
	}
	for _, path := range []string{"/api/v1/transcription/list", "/api/v1/transcription/list?q=.wav", "/api/v1/transcription/list?updated_after=2000-01-01T00:00:00Z"} {
		w := call("GET", path, "", tokens[a.Username])
		if w.Code != 200 || strings.Contains(w.Body.String(), "bob-job") || strings.Contains(w.Body.String(), `"id":"old"`) || !strings.Contains(w.Body.String(), "alice-job") {
			t.Errorf("unisolated list: %s", w.Body.String())
		}
	}
	// Administrator has no implicit access to another person's recordings.
	if w := call("GET", "/api/v1/transcription/bob-job", "", tokens[admin.Username]); w.Code != 404 {
		t.Fatal("admin privacy bypass")
	}
	// New jobs bind owner from request context and cannot spoof a different owner.
	created := models.TranscriptionJob{ID: "new", OwnerID: b.ID, AudioPath: "new.wav"}
	h.jobRepo.Create(models.WithRequestOwner(context.Background(), a.ID), &created)
	if created.OwnerID != a.ID {
		t.Fatal("spoofed owner")
	}
	// Approved profile is loaded server-side; arbitrary parameters are ignored.
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set("role", "user")
	ctx.Request = httptest.NewRequest("POST", "/start", strings.NewReader(`{"profile_id":"approved","device":"cpu","model_dir":"/private/other-user"}`))
	ctx.Request.Header.Set("Content-Type", "application/json")
	params, err := h.getValidatedTranscriptionParams(ctx, &jA, jA.ID)
	if err != nil || params.Device != "cuda" || params.ModelDir != nil || params.HfToken == nil {
		t.Fatalf("profile validation: %v %+v", err, params)
	}
	// A regular user may select the audio language while model/system settings remain profile-controlled.
	for _, language := range []string{"en", "zh", "auto"} {
		ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
		ctx.Set("role", "user")
		ctx.Request = httptest.NewRequest("POST", "/start", strings.NewReader(fmt.Sprintf(`{"profile_id":"approved","language":%q,"device":"cpu","model_dir":"/private/other-user"}`, language)))
		ctx.Request.Header.Set("Content-Type", "application/json")
		params, err := h.getValidatedTranscriptionParams(ctx, &jA, jA.ID)
		if err != nil || params.Language == nil || *params.Language != language || params.Device != "cuda" || params.ModelDir != nil || params.Model != "Qwen/Qwen3-ASR-1.7B" {
			t.Fatalf("user language selection: %v %+v", err, params)
		}
	}
	// Demoting/disabling self is rejected; ordinary users cannot change accounts.
	if w := call("PATCH", fmt.Sprintf("/api/v1/admin/users/%d", admin.ID), `{"disabled":true}`, tokens[admin.Username]); w.Code != 400 {
		t.Fatal("self disable allowed")
	}
	w := call("POST", "/api/v1/admin/users", `{"username":"new-user","password":"new-password","role":"user"}`, tokens[admin.Username])
	if w.Code != 201 {
		t.Fatalf("create: %s", w.Body.String())
	}
	var newUser models.User
	json.Unmarshal(w.Body.Bytes(), &newUser)
	if newUser.Role != "user" {
		t.Fatal("incorrect new role")
	}
	if w := call("GET", "/api/v1/admin/users", "", tokens[admin.Username]); w.Code != 200 || strings.Contains(w.Body.String(), "test-password") {
		t.Fatal("admin list")
	}
	w = call("PATCH", fmt.Sprintf("/api/v1/admin/users/%d", a.ID), `{"disabled":true}`, tokens[admin.Username])
	if w.Code != 200 {
		t.Fatalf("disable: %s", w.Body.String())
	}
	if w := call("GET", "/api/v1/auth/me", "", tokens[a.Username]); w.Code != 401 {
		t.Fatal("disabled JWT still works")
	}
	w = call("PATCH", fmt.Sprintf("/api/v1/admin/users/%d", a.ID), `{"disabled":false}`, tokens[admin.Username])
	if w.Code != 200 {
		t.Fatal("enable failed")
	}
	if w := call("GET", "/api/v1/auth/me", "", tokens[a.Username]); w.Code != 401 {
		t.Fatal("re-enabled old JWT works")
	}
	req := httptest.NewRequest("GET", "/api/v1/transcription/old", nil)
	req.Header.Set("X-API-Key", key.Key)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatal("legacy key owner lost")
	}
	req = httptest.NewRequest("GET", "/api/v1/voiceprints/", nil)
	req.Header.Set("X-API-Key", key.Key)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != 403 {
		t.Fatal("key accesses private voiceprints")
	}
	if err := database.MigrateOwnership(db); err != nil {
		t.Fatal(err)
	}
	db.First(&jB, "id = ?", jB.ID)
	if jB.OwnerID != b.ID {
		t.Fatal("second migration reassigned existing data")
	}
}
func strPtr(s string) *string { return &s }
