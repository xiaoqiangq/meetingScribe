package adapters

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"scriberr/internal/transcription/interfaces"
	"strings"
	"testing"
)

func TestShortRecommendationsKeepDiarizationAndTolerateFailure(t *testing.T) {
	for _, fail := range []bool{false, true} {
		root, err := os.MkdirTemp("", "short-native-fixture-")
		if err != nil {
			t.Fatal(err)
		}
		env := filepath.Join(root, "runtime")
		if err := os.MkdirAll(filepath.Join(env, ".venv/bin"), 0700); err != nil {
			t.Fatal(err)
		}
		calls := filepath.Join(root, "calls")
		helper := `mkdir -p "$output"; printf '%s' '{"speakers":[{"speaker":"speaker_0","topic":"recording","status":"needs_review","scores":[],"windows":[]}],"links":[]}' > "$output/topic-recommendations.json"`
		if fail {
			helper = "exit 9"
		}
		script := `#!/bin/sh
case "$1" in
 *native_topic_recommendations.py)
  printf 'name\n' >> '` + calls + `'
  while [ "$#" -gt 0 ]; do if [ "$1" = '--output' ]; then shift; output="$1"; fi; shift; done
  ` + helper + `
  ;;
 *)
  printf 'diarization\n' >> '` + calls + `'
  printf '%s' '{"segments":[{"start":1,"end":8,"speaker":"speaker_0"}],"speakers":["speaker_0"],"speaker_count":1}' > "$3"
  ;;
esac
`
		if err := os.WriteFile(filepath.Join(env, ".venv/bin/python"), []byte(script), 0700); err != nil {
			t.Fatal(err)
		}
		audio := filepath.Join(root, "audio.wav")
		if err := os.WriteFile(audio, []byte("fixture"), 0600); err != nil {
			t.Fatal(err)
		}
		t.Setenv("TOPIC_NATIVE_REFERENCE_ROOT", filepath.Join(root, "references"))
		t.Setenv("TOPIC_VOICEPRINT_LIBRARY", "")
		result, err := NewNemotronAdapter(env).Diarize(context.Background(), interfaces.AudioInput{FilePath: audio, Format: "wav", SampleRate: 16000, Channels: 1, Size: 7}, map[string]interface{}{"auto_convert_audio": false}, interfaces.ProcessingContext{JobID: "short-fixture", OutputDirectory: root, TempDirectory: root})
		if err != nil {
			t.Fatal(err)
		}
		if len(result.Segments) != 1 || result.Segments[0].Speaker != "speaker_0" || result.Segments[0].Start != 1 || result.Segments[0].End != 8 {
			t.Fatalf("diarization changed: %+v", result)
		}
		raw, _ := os.ReadFile(calls)
		if strings.Count(string(raw), "diarization\n") != 1 || strings.Count(string(raw), "name\n") != 1 {
			t.Fatalf("unexpected calls %s", raw)
		}
		status := "suggestions_only"
		if fail {
			status = "failed"
		}
		if result.Metadata["voiceprint_status"] != status {
			t.Fatalf("status %v", result.Metadata)
		}
		report, err := os.ReadFile(filepath.Join(root, "topic-recommendations.json"))
		if err != nil || !json.Valid(report) {
			t.Fatalf("missing report: %v", err)
		}
	}
}
