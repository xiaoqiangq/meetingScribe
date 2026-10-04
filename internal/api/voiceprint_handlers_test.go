package api

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"scriberr/internal/config"
)

func TestVoiceprintLibrarySeedAndPrivateAudio(t *testing.T) {
	root := t.TempDir()
	seed := filepath.Join(root, "seed")
	os.MkdirAll(filepath.Join(seed, "samples"), 0700)
	plan := voiceprintPlan{SourceJob: "old", SourceAudioSHA256: "source-hash", Samples: []voiceprintSample{
		{Name: "甲", PersonID: "one", Speaker: "speaker_0", Role: "reference", File: "one.wav", Start: 1, End: 7},
		{Name: "甲", Role: "validation", File: "validation.wav", Start: 1, End: 7},
		{Name: "乙", PersonID: "two", Speaker: "speaker_1", Role: "reference", File: "two.wav", Start: 2, End: 6},
	}}
	for _, name := range []string{"one.wav", "two.wav"} {
		if err := os.WriteFile(filepath.Join(seed, "samples", name), []byte("test audio"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := writeVoiceprintJSON(filepath.Join(seed, "sample-plan.json"), plan); err != nil {
		t.Fatal(err)
	}
	t.Setenv("NATIVE_VOICEPRINT_SEED_ROOT", seed)
	t.Setenv("TOPIC_NATIVE_REFERENCE_ROOT", "")
	h := &Handler{config: &config.Config{UploadDir: filepath.Join(root, "data", "uploads")}}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/", h.ListVoiceprints)
	r.GET("/samples/:file", h.GetVoiceprintAudio)
	response := httptest.NewRecorder()
	r.ServeHTTP(response, httptest.NewRequest("GET", "/", nil))
	var body struct {
		People []voiceprintPerson `json:"people"`
		Model  string             `json:"model"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if response.Code != 200 || len(body.People) != 2 || body.People[0].Duration != 6 || body.Model != "nvidia/Nemotron-3-Diarization" {
		t.Fatalf("unexpected list: %s", response.Body.String())
	}
	if _, err := os.Stat(filepath.Join(h.voiceprintRoot(), "samples", "validation.wav")); !os.IsNotExist(err) {
		t.Fatal("validation audio imported")
	}
	for _, test := range []struct {
		path string
		code int
	}{{"/samples/one.wav", 200}, {"/samples/unregistered.wav", 404}, {"/samples/sample-plan.json", 404}} {
		res := httptest.NewRecorder()
		r.ServeHTTP(res, httptest.NewRequest("GET", test.path, nil))
		if res.Code != test.code {
			t.Fatalf("%s: %d", test.path, res.Code)
		}
	}
	// Reopening must preserve new registrations and must not reimport old files.
	data, _ := os.ReadFile(filepath.Join(h.voiceprintRoot(), "sample-plan.json"))
	if !strings.Contains(string(data), "source-hash") {
		t.Fatal("source provenance lost")
	}
	if !strings.Contains(string(data), "one.wav") {
		t.Fatal("missing registration")
	}
}

func TestVoiceprintRejectsSeedTraversal(t *testing.T) {
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "seed"), 0700)
	writeVoiceprintJSON(filepath.Join(root, "seed", "sample-plan.json"), voiceprintPlan{Samples: []voiceprintSample{{Role: "reference", File: "../private.wav"}}})
	t.Setenv("NATIVE_VOICEPRINT_SEED_ROOT", filepath.Join(root, "seed"))
	t.Setenv("TOPIC_NATIVE_REFERENCE_ROOT", "")
	h := &Handler{config: &config.Config{UploadDir: filepath.Join(root, "data", "uploads")}}
	if _, err := h.loadVoiceprintPlan(); err == nil {
		t.Fatal("traversal accepted")
	}
}
