package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"scriberr/internal/auth"
	"scriberr/internal/config"
	"scriberr/internal/web"
)

func TestRealtimePageRoutesShareSPAAndKeepLivenessSeparate(t *testing.T) {
	authService := auth.NewAuthService("route-test-secret")
	router := SetupRoutes(&Handler{config: &config.Config{}}, authService)
	index, err := web.GetIndexHTML()
	if err != nil {
		t.Fatal(err)
	}
	for _, origin := range []string{"http://localhost:18088", "http://192.0.2.10:8088", "https://192.0.2.10:8443"} {
		for _, path := range []string{"/live", "/live/", "/live?project=existing-project"} {
			t.Run(origin+path, func(t *testing.T) {
				w := httptest.NewRecorder()
				req := httptest.NewRequest(http.MethodGet, origin+path, nil)
				req.Header.Set("Accept", "text/html")
				router.ServeHTTP(w, req)
				if w.Code != http.StatusOK || !strings.HasPrefix(w.Header().Get("Content-Type"), "text/html") || !bytes.Equal(w.Body.Bytes(), index) {
					t.Fatalf("realtime navigation must return SPA HTML: status=%d type=%s", w.Code, w.Header().Get("Content-Type"))
				}
				if w.Header().Get("Location") != "" {
					t.Fatal("independent origins must not redirect")
				}
			})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, origin+"/health/live", nil))
		var probe struct {
			Status string `json:"status"`
		}
		if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &probe) != nil || probe.Status != "alive" {
			t.Fatalf("unauthenticated liveness probe failed: %s", w.Body.String())
		}
	}
}
