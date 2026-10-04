package adapters

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"scriberr/internal/transcription/interfaces"
)

func TestNemotronCapacityAndCompatibility(t *testing.T) {
	a := NewNemotronAdapter(t.TempDir())
	if a.GetMaxSpeakers() != 8 || a.GetCapabilities().ModelID != "sortformer" {
		t.Fatal("eight-speaker adapter must retain Chunk Manager routing ID")
	}
	for _, max := range []int{4, 8} {
		if err := a.ValidateParameters(map[string]interface{}{"max_speakers": max}); err != nil {
			t.Fatal(err)
		}
	}
	if err := a.ValidateParameters(map[string]interface{}{"max_speakers": 9}); err == nil {
		t.Fatal("accepted nine speakers")
	}
	if a.GetCapabilities().Metadata["license"] != "OpenMDW-1.1" {
		t.Fatal("wrong model license")
	}
}

func TestLegacySortformerHasSeparateIdentity(t *testing.T) {
	a := NewLegacySortformerAdapter(t.TempDir())
	if a.GetMaxSpeakers() != 4 || a.GetCapabilities().ModelID != "sortformer_4spk" {
		t.Fatal("legacy identity or capacity is incorrect")
	}
}

func TestLegacySortformerLiveAdapter(t *testing.T) {
	env, audio, out := os.Getenv("LEGACY_RUNTIME"), os.Getenv("LEGACY_AUDIO"), os.Getenv("LEGACY_OUTPUT")
	if env == "" || audio == "" || out == "" {
		t.Skip("requires explicit GPU fixture paths")
	}
	if err := os.MkdirAll(out, 0755); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	a := NewLegacySortformerAdapter(env)
	if err := a.PrepareEnvironment(ctx); err != nil {
		t.Fatal(err)
	}
	stat, err := os.Stat(audio)
	if err != nil {
		t.Fatal(err)
	}
	result, err := a.Diarize(ctx, interfaces.AudioInput{FilePath: audio, Format: "wav", SampleRate: 16000, Channels: 1, Size: stat.Size()}, map[string]interface{}{"device": "cuda", "batch_size": 1, "output_format": "json", "auto_convert_audio": false}, interfaces.ProcessingContext{JobID: "legacy-smoke", OutputDirectory: out, TempDirectory: out})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Segments) == 0 || result.SpeakerCount > 4 || result.ModelUsed != "diar_streaming_sortformer_4spk-v2" {
		t.Fatalf("invalid legacy result: %+v", result)
	}
	t.Logf("legacy adapter returned %d intervals, %d labels, model=%s", len(result.Segments), result.SpeakerCount, result.ModelUsed)
}

func TestNemotronJSONPreservesEightLabelsAndOverlaps(t *testing.T) {
	dir := t.TempDir()
	a := NewNemotronAdapter(dir)
	segments := []map[string]interface{}{}
	speakers := []string{}
	for i := 0; i < 8; i++ {
		speaker := "speaker_" + string(rune('0'+i))
		speakers = append(speakers, speaker)
		segments = append(segments, map[string]interface{}{"start": 1200.01 + float64(i), "end": 1202.02 + float64(i), "speaker": speaker})
	}
	payload := map[string]interface{}{"segments": segments, "speakers": speakers, "speaker_count": 8}
	data, _ := json.Marshal(payload)
	if err := os.WriteFile(filepath.Join(dir, "result.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	result, err := a.parseNemotronJSON(dir)
	if err != nil {
		t.Fatal(err)
	}
	if result.Segments[0].Start != 1200.01 || result.Segments[7].Speaker != "speaker_7" || result.Segments[0].End <= result.Segments[1].Start {
		t.Fatalf("changed seconds, IDs or overlap: %+v", result)
	}
	if result.Segments[0].Confidence != 0 {
		t.Fatal("fabricated confidence")
	}
	payload["speaker_count"] = 4
	data, _ = json.Marshal(payload)
	if err := os.WriteFile(filepath.Join(dir, "result.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := a.parseNemotronJSON(dir); err == nil {
		t.Fatal("accepted inconsistent counts")
	}
}

func TestNemotronSavedOutput(t *testing.T) {
	dir := os.Getenv("NEMOTRON_FIXTURE_DIR")
	if dir == "" {
		t.Skip("set NEMOTRON_FIXTURE_DIR to a saved native result.json")
	}
	result, err := NewNemotronAdapter(dir).parseNemotronJSON(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Segments) == 0 {
		t.Fatal("expected speech intervals")
	}
	t.Logf("validated %d intervals, %d labels", len(result.Segments), result.SpeakerCount)
}

// Explicit opt-in real GPU smoke; writes only the supplied diagnostic directory.
func TestNemotronLiveAdapter(t *testing.T) {
	env, audio, out := os.Getenv("NEMOTRON_RUNTIME"), os.Getenv("NEMOTRON_AUDIO"), os.Getenv("NEMOTRON_OUTPUT")
	if env == "" || audio == "" || out == "" {
		t.Skip("requires explicit isolated GPU fixture paths")
	}
	if err := os.MkdirAll(out, 0755); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	a := NewNemotronAdapter(env)
	if err := a.PrepareEnvironment(ctx); err != nil {
		t.Fatal(err)
	}
	stat, err := os.Stat(audio)
	if err != nil {
		t.Fatal(err)
	}
	result, err := a.Diarize(ctx, interfaces.AudioInput{FilePath: audio, Format: "wav", SampleRate: 16000, Channels: 1, Size: stat.Size()},
		map[string]interface{}{"device": "cuda", "batch_size": 1, "max_speakers": 8, "output_format": "json", "auto_convert_audio": false},
		interfaces.ProcessingContext{JobID: "adapter-smoke", OutputDirectory: out, TempDirectory: out})
	if err != nil {
		t.Fatal(err)
	}
	if result.ModelUsed != nemotronModel || len(result.Segments) == 0 || result.Metadata["timestamp_origin"] != "full_audio" {
		t.Fatalf("invalid result: %+v", result)
	}
	t.Logf("live adapter returned %d intervals, %d labels, checkpoint=%s", len(result.Segments), result.SpeakerCount, result.ModelUsed)
}
