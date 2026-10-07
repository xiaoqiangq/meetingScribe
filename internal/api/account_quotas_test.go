package api

import (
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"net/http"
	"net/http/httptest"
	"scriberr/internal/database"
	"scriberr/internal/models"
	"strings"
	"testing"
)

func TestQuotaOnlyUpdatePreservesLoginAndRejectsNegative(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sql, _ := db.DB()
	sql.SetMaxOpenConns(1)
	defer sql.Close()
	previous := database.DB
	database.DB = db
	defer func() { database.DB = previous }()
	db.AutoMigrate(&models.User{})
	user := models.User{Username: "admin", Role: "admin", Password: "test", TokenVersion: 7}
	db.Create(&user)
	call := func(body string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("user_id", user.ID)
		c.Params = gin.Params{{Key: "id", Value: "1"}}
		c.Request = httptest.NewRequest("PATCH", "/", strings.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		(&Handler{}).UpdateUser(c)
		return w
	}
	if w := call(`{"project_limit":50,"file_quota_bytes":10737418240,"audio_quota_bytes":5368709120}`); w.Code != 200 {
		t.Fatalf("quota update failed: %s", w.Body)
	}
	db.First(&user, user.ID)
	if user.TokenVersion != 7 || user.ProjectLimit != 50 || effectiveAudioQuota(user) != 5368709120 {
		t.Fatalf("wrong saved limits or revoked login: %+v", user)
	}
	if w := call(`{"project_limit":-1}`); w.Code != 400 {
		t.Fatal("negative limit accepted")
	}
}
func TestUploadRejectsPerUserProjectAndAudioLimits(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sql, _ := db.DB()
	sql.SetMaxOpenConns(1)
	defer sql.Close()
	previous := database.DB
	database.DB = db
	defer func() { database.DB = previous }()
	db.AutoMigrate(&models.User{}, &models.TranscriptionJob{})
	user := models.User{Username: "one", Password: "test", ProjectLimit: 1}
	db.Create(&user)
	db.Create(&models.TranscriptionJob{ID: "existing", OwnerID: user.ID, AudioPath: "missing", AudioBytes: 10})
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set("user_id", user.ID) }, requestLimits())
	r.POST("/upload", func(c *gin.Context) { c.Status(200) })
	request := func() *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/upload", strings.NewReader("test")))
		return w
	}
	if w := request(); w.Code != 413 || !strings.Contains(w.Body.String(), "project limit") {
		t.Fatalf("project limit not enforced: %d %s", w.Code, w.Body)
	}
	db.Model(&user).Updates(map[string]interface{}{"project_limit": 0, "audio_quota_bytes": 10})
	if w := request(); w.Code != 413 || !strings.Contains(w.Body.String(), "audio storage quota") {
		t.Fatalf("audio quota not enforced: %d %s", w.Code, w.Body)
	}
	db.Model(&user).Update("audio_quota_bytes", 100)
	if w := request(); w.Code != 200 {
		t.Fatalf("upload within limits blocked: %d %s", w.Code, w.Body)
	}
	db.Model(&user).Update("file_quota_bytes", 2)
	if w := request(); w.Code != 413 {
		t.Fatal("incoming file storage budget not enforced")
	}
}
