package transcription

import (
	"encoding/json"
	"os"
	"path/filepath"
	"scriberr/internal/transcription/interfaces"
	"strings"
	"testing"
)

func TestTopicBoundaryStopsShortClauseVoting(t *testing.T) {
	words := []interfaces.TranscriptWord{clauseWord(9.5, 9.9, "好的"), clauseWord(10.1, 10.4, "继续。")}
	d := &interfaces.DiarizationResult{Metadata: map[string]string{"topic_ranges": `[{"id":1,"start":0,"end":10},{"id":2,"start":10,"end":20}]`}, Segments: []interfaces.DiarizationSegment{{Start: 0, End: 10, Speaker: "topic1/speaker_0"}, {Start: 10, End: 20, Speaker: "topic2/speaker_0"}}}
	assignTopicClauseSpeakers(words, d)
	assertClauseSpeakers(t, words, []string{"topic1/speaker_0", "topic2/speaker_0"})
}

// Prepare an offline repair from the saved transcript; never modify the DB here.
func TestPrepareSavedTopicRepair(t *testing.T) {
	root := os.Getenv("TOPIC_REPAIR_FIXTURE")
	if root == "" {
		t.Skip("explicit saved-job fixture required")
	}
	var before interfaces.TranscriptResult
	var diarization interfaces.DiarizationResult
	for _, item := range []struct {
		name   string
		target any
	}{{"saved-transcript.json", &before}, {"diarization-result.json", &diarization}} {
		data, err := os.ReadFile(filepath.Join(root, item.name))
		if err != nil {
			t.Fatal(err)
		}
		if err = json.Unmarshal(data, item.target); err != nil {
			t.Fatal(err)
		}
	}
	if diarization.Metadata["topic_mode"] == "" {
		t.Fatal("missing topic metadata")
	}
	after := (&UnifiedTranscriptionService{}).mergeDiarizationWithTranscription(&before, &diarization, true)
	if after.Text != before.Text || len(after.WordSegments) != len(before.WordSegments) || len(after.Segments) != len(before.Segments) {
		t.Fatal("text/count changed")
	}
	labels := map[string]int{}
	for i, w := range after.WordSegments {
		old := before.WordSegments[i]
		if w.Start != old.Start || w.End != old.End || w.Word != old.Word {
			t.Fatal("word text/time changed")
		}
		if w.Speaker != nil {
			if !strings.HasPrefix(*w.Speaker, "topic") {
				t.Fatalf("stale label %s", *w.Speaker)
			}
			labels[*w.Speaker]++
			mid := (w.Start + w.End) / 2
			if (mid < 2580 && !strings.HasPrefix(*w.Speaker, "topic1/")) || (mid >= 2580 && !strings.HasPrefix(*w.Speaker, "topic2/")) {
				t.Fatalf("topic label crossed cut at %.3f", mid)
			}
		}
	}
	for i, s := range after.Segments {
		old := before.Segments[i]
		if s.Text != old.Text || s.Start != old.Start || s.End != old.End {
			t.Fatal("segment text/time changed")
		}
	}
	if len(labels) < 2 {
		t.Fatal("missing topic labels")
	}
	raw, err := json.Marshal(after)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "repaired-transcript.json")
	if _, err := os.Stat(path); err == nil {
		t.Fatal("existing repair must be retained")
	}
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	t.Logf("all %d words retained; labels=%v", len(after.WordSegments), labels)
}
