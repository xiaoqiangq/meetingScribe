package transcription

import (
	"fmt"
	"testing"

	"scriberr/internal/transcription/interfaces"
)

func TestNemotronEightSpeakersSurviveClauseMerge(t *testing.T) {
	transcript := &interfaces.TranscriptResult{Metadata: map[string]string{"aligner": "Qwen3-ForcedAligner-0.6B"}}
	diarization := &interfaces.DiarizationResult{ModelUsed: "nvidia/Nemotron-3-Diarization"}
	for i := 0; i < 8; i++ {
		start := 1200.01 + float64(i)*10
		transcript.WordSegments = append(transcript.WordSegments, interfaces.TranscriptWord{Start: start, End: start + 1, Word: "你好。"})
		transcript.Segments = append(transcript.Segments, interfaces.TranscriptSegment{Start: start, End: start + 1, Text: "你好。"})
		diarization.Segments = append(diarization.Segments, interfaces.DiarizationSegment{Start: start, End: start + 2, Speaker: fmt.Sprintf("speaker_%d", i)})
	}
	merged := (&UnifiedTranscriptionService{}).mergeDiarizationWithTranscription(transcript, diarization, true)
	for i, word := range merged.WordSegments {
		if word.Speaker == nil || *word.Speaker != fmt.Sprintf("speaker_%d", i) || word.Start != transcript.WordSegments[i].Start || word.End != transcript.WordSegments[i].End || word.Word != "你好。" {
			t.Fatalf("speaker/time/text lost at word %d: %+v", i, word)
		}
	}
	if merged.Metadata["diarization_model"] != diarization.ModelUsed || merged.Metadata["diarization_max_speakers"] != "8" {
		t.Fatal("missing checkpoint metadata")
	}
	if transcript.Metadata["diarization_model"] != "" {
		t.Fatal("mutated original metadata")
	}
}
