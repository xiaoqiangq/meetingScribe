package adapters

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"scriberr/internal/transcription/interfaces"
	"strings"
	"testing"
	"time"
)

func TestNemotronTopicRealAudio(t *testing.T) {
	env, audio, out := os.Getenv("NEMOTRON_RUNTIME"), os.Getenv("TOPIC_AUDIO"), os.Getenv("TOPIC_OUTPUT")
	if env == "" || audio == "" || out == "" {
		t.Skip("requires explicit isolated fixture")
	}
	if err := os.MkdirAll(out, 0700); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	info, err := os.Stat(audio)
	if err != nil {
		t.Fatal(err)
	}
	result, err := NewNemotronAdapter(env).Diarize(ctx, interfaces.AudioInput{FilePath: audio, Format: "wav", SampleRate: 16000, Channels: 1, Size: info.Size()}, map[string]interface{}{"topic_mode": true, "topic_boundaries": []float64{2580}, "device": "cuda", "batch_size": 1}, interfaces.ProcessingContext{JobID: "topic-real-6316", OutputDirectory: out, TempDirectory: out})
	if err != nil {
		t.Fatal(err)
	}
	counts := map[string]int{}
	for _, s := range result.Segments {
		if s.Start < 0 || s.End > 3796 || s.End <= s.Start {
			t.Fatalf("bad interval %+v", s)
		}
		if strings.HasPrefix(s.Speaker, "topic1/") {
			if s.End > 2580 {
				t.Fatal("topic1 crosses cut")
			}
			counts["topic1"]++
		} else if strings.HasPrefix(s.Speaker, "topic2/") {
			if s.Start < 2580 {
				t.Fatal("topic2 crosses cut")
			}
			counts["topic2"]++
		} else {
			t.Fatal("unscoped speaker")
		}
	}
	if counts["topic1"] == 0 || counts["topic2"] == 0 {
		t.Fatal("missing topic")
	}
	raw, _ := json.MarshalIndent(result, "", "  ")
	if err := os.WriteFile(filepath.Join(out, "diarization-result.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	t.Logf("intervals=%d speakers=%d topics=%v voiceprint=%s", len(result.Segments), result.SpeakerCount, counts, result.Metadata["voiceprint_status"])
}

// Exercise the actual adapter orchestration with a deterministic inference
// fixture. Both sessions intentionally return speaker_0; they must stay distinct.
func TestTopicAdapterResetsAndScopesSessions(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg unavailable")
	}
	root, err := os.MkdirTemp("", "topic-adapter-fixture-")
	if err != nil {
		t.Fatal(err)
	}
	env := filepath.Join(root, "runtime")
	if err := os.MkdirAll(filepath.Join(env, ".venv", "bin"), 0700); err != nil {
		t.Fatal(err)
	}
	calls := filepath.Join(root, "calls.txt")
	script := "#!/bin/sh\nprintf 'call\\n' >> '" + calls + "'\nprintf '%s' '{\"segments\":[{\"start\":0,\"end\":20,\"speaker\":\"speaker_0\"}],\"speakers\":[\"speaker_0\"],\"speaker_count\":1}' > \"$3\"\n"
	if err := os.WriteFile(filepath.Join(env, ".venv", "bin", "python"), []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	audio := filepath.Join(root, "audio.wav")
	if log, err := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "20", audio).CombinedOutput(); err != nil {
		t.Fatalf("%v: %s", err, log)
	}
	t.Setenv("TOPIC_VOICEPRINT_LIBRARY", "")
	audioInfo, err := os.Stat(audio)
	if err != nil {
		t.Fatal(err)
	}
	result, err := NewNemotronAdapter(env).Diarize(context.Background(), interfaces.AudioInput{FilePath: audio, Size: audioInfo.Size(), Format: "wav", SampleRate: 16000, Channels: 1}, map[string]interface{}{"topic_mode": true, "topic_boundaries": []float64{10}}, interfaces.ProcessingContext{JobID: "fixture", OutputDirectory: root, TempDirectory: root})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Segments) != 2 || result.Segments[0].Speaker != "topic1/speaker_0" || result.Segments[1].Speaker != "topic2/speaker_0" || result.Segments[0].End != 10 || result.Segments[1].Start != 10 || result.Segments[1].End != 20 {
		t.Fatalf("bad scope or offsets: %+v", result.Segments)
	}
	raw, _ := os.ReadFile(calls)
	if strings.Count(string(raw), "call") != 2 {
		t.Fatal("did not invoke independent sessions")
	}
	// Retries must create a fresh scratch directory, never reuse a cropped file.
	if _, err := NewNemotronAdapter(env).Diarize(context.Background(), interfaces.AudioInput{FilePath: audio, Size: audioInfo.Size(), Format: "wav", SampleRate: 16000, Channels: 1}, map[string]interface{}{"topic_mode": true, "topic_boundaries": []float64{10}}, interfaces.ProcessingContext{JobID: "fixture", OutputDirectory: root, TempDirectory: root}); err != nil {
		t.Fatal(err)
	}
}
