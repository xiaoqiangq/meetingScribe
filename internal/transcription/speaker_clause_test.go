package transcription

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"scriberr/internal/transcription/interfaces"
)

// Optional real-recording regression without changing the saved job or loading models.
func TestShortClauseSavedRecording(t *testing.T) {
	directory := os.Getenv("MEETING_CLAUSE_FIXTURE_DIR")
	if directory == "" {
		t.Skip("set MEETING_CLAUSE_FIXTURE_DIR to saved ASR/Sortformer JSON")
	}
	var transcript interfaces.TranscriptResult
	var diarization interfaces.DiarizationResult
	for _, fixture := range []struct {
		name   string
		target any
	}{
		{"funasr-result.json", &transcript}, {"diarization-result.json", &diarization},
	} {
		data, err := os.ReadFile(filepath.Join(directory, fixture.name))
		if err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(data, fixture.target); err != nil {
			t.Fatal(err)
		}
	}
	service := &UnifiedTranscriptionService{}
	baseline := service.mergeDiarizationWithTranscription(&transcript, &diarization, false)
	// Reproduce v1 in this audit only, to measure exactly what v2 changes.
	onsets := sustainedSpeakerChangeOnsets(diarization.Segments)
	start := 0
	for index, word := range baseline.WordSegments {
		if index > start {
			previous := baseline.WordSegments[index-1]
			if word.Start-previous.End >= clausePauseSeconds || crossesSpeakerOnset((previous.Start+previous.End)/2, (word.Start+word.End)/2, onsets) {
				assignClauseSpeaker(baseline.WordSegments[start:index], diarization.Segments)
				start = index
			}
		}
		if endsSpokenClause(word.Word) {
			assignClauseSpeaker(baseline.WordSegments[start:index+1], diarization.Segments)
			start = index + 1
		}
	}
	assignClauseSpeaker(baseline.WordSegments[start:], diarization.Segments)
	updated := service.mergeDiarizationWithTranscription(&transcript, &diarization, true)
	changes, found := 0, 0
	for index, word := range updated.WordSegments {
		original := transcript.WordSegments[index]
		if word.Word != original.Word || word.Start != original.Start || word.End != original.End {
			t.Fatal("text/time changed")
		}
		old := baseline.WordSegments[index]
		if word.Speaker != nil && old.Speaker != nil && *word.Speaker != *old.Speaker {
			changes++
			t.Logf("changed %.3f–%.3f %q: %s -> %s", word.Start, word.End, word.Word, *old.Speaker, *word.Speaker)
		}
		if word.Start >= 1057.53 && word.Start < 1057.79 && (word.Word == "现" || word.Word == "在") {
			found++
			if word.Speaker == nil || *word.Speaker != "speaker_3" {
				t.Fatalf("seam word %q not speaker_3", word.Word)
			}
		}
	}
	if found != 2 {
		t.Fatalf("expected two seam characters, found %d", found)
	}
	t.Logf("audited %d words; %d changed from v1; all text/times unchanged", len(updated.WordSegments), changes)
}

func TestShortClauseProtectsLatestChunk56To57Seam(t *testing.T) {
	words := []interfaces.TranscriptWord{
		clauseWord(1057.54, 1057.62, "现"),
		clauseWord(1057.62, 1057.78, "在"),
		clauseWord(1057.78, 1058.42, "我就跟你讲，"),
	}
	turns := []interfaces.DiarizationSegment{
		{Start: 1051.52, End: 1057.60, Speaker: "speaker_0"},
		{Start: 1057.60, End: 1059.92, Speaker: "speaker_3"},
	}
	before := append([]interfaces.TranscriptWord(nil), words...)
	assignClauseMajoritySpeakers(words, turns)
	assertClauseSpeakers(t, words, []string{"speaker_3", "speaker_3", "speaker_3"})
	for i := range words {
		if words[i].Word != before[i].Word || words[i].Start != before[i].Start || words[i].End != before[i].End {
			t.Fatal("short-clause protection must not edit text or timestamps")
		}
	}
}

func TestShortClauseStillRespectsLongPause(t *testing.T) {
	words := []interfaces.TranscriptWord{clauseWord(0.1, 0.5, "好的"), clauseWord(1.4, 1.8, "开始")}
	turns := []interfaces.DiarizationSegment{
		{Start: 0, End: 1, Speaker: "speaker_0"},
		{Start: 1.3, End: 4, Speaker: "speaker_3"},
	}
	assignClauseMajoritySpeakers(words, turns)
	assertClauseSpeakers(t, words, []string{"speaker_0", "speaker_3"})
}

func TestCharacterLimitRetainsStableTurnFallback(t *testing.T) {
	words := []interfaces.TranscriptWord{
		clauseWord(1.5, 2.0, strings.Repeat("甲", 16)),
		clauseWord(2.0, 3.0, strings.Repeat("乙", 15)),
	}
	turns := []interfaces.DiarizationSegment{
		{Start: 0, End: 2, Speaker: "speaker_0"},
		{Start: 2, End: 5, Speaker: "speaker_3"},
	}
	assignClauseMajoritySpeakers(words, turns)
	assertClauseSpeakers(t, words, []string{"speaker_0", "speaker_3"})
}

func clauseWord(start, end float64, value string) interfaces.TranscriptWord {
	return interfaces.TranscriptWord{Start: start, End: end, Word: value}
}

func assertClauseSpeakers(t *testing.T, words []interfaces.TranscriptWord, expected []string) {
	t.Helper()
	for index, word := range words {
		if word.Speaker == nil || *word.Speaker != expected[index] {
			t.Fatalf("word %d %q speaker=%v; want %q", index, word.Word, word.Speaker, expected[index])
		}
	}
}

func TestClauseMajorityMovesBoundaryWordTogether(t *testing.T) {
	words := []interfaces.TranscriptWord{
		clauseWord(0.10, 0.30, "现"),
		clauseWord(0.30, 0.48, "在"),
		clauseWord(0.48, 0.65, "我"),
		clauseWord(0.65, 0.89, "讲。"),
	}
	turns := []interfaces.DiarizationSegment{
		{Start: 0, End: 0.25, Speaker: "speaker_0"},
		{Start: 0.21, End: 1.5, Speaker: "speaker_3"},
	}
	start, end := words[0].Start, words[0].End
	assignClauseMajoritySpeakers(words, turns)
	assertClauseSpeakers(t, words, []string{"speaker_3", "speaker_3", "speaker_3", "speaker_3"})
	if words[0].Start != start || words[0].End != end {
		t.Fatal("speaker reassignment must not modify word timing")
	}
}

func TestClauseMajorityRespectsPunctuationAndStableTurn(t *testing.T) {
	words := []interfaces.TranscriptWord{
		clauseWord(0.10, 0.32, "我"),
		clauseWord(0.32, 0.64, "觉得，"),
		clauseWord(0.65, 0.82, "你"),
		clauseWord(0.82, 1.10, "没听懂。"),
	}
	turns := []interfaces.DiarizationSegment{
		{Start: 0, End: 0.76, Speaker: "speaker_0"},
		{Start: 0.70, End: 3.0, Speaker: "speaker_3"},
	}
	assignClauseMajoritySpeakers(words, turns)
	assertClauseSpeakers(t, words, []string{"speaker_0", "speaker_0", "speaker_3", "speaker_3"})
}

func TestClauseMajorityKeepsBriefSpuriousLabelInsidePhrase(t *testing.T) {
	words := []interfaces.TranscriptWord{
		clauseWord(0.1, 0.4, "这个"),
		clauseWord(0.4, 0.7, "方向"),
		clauseWord(0.7, 0.9, "对。"),
	}
	turns := []interfaces.DiarizationSegment{
		{Start: 0, End: 0.52, Speaker: "speaker_2"},
		{Start: 0.52, End: 0.64, Speaker: "speaker_3"},
		{Start: 0.64, End: 1.5, Speaker: "speaker_2"},
	}
	assignClauseMajoritySpeakers(words, turns)
	assertClauseSpeakers(t, words, []string{"speaker_2", "speaker_2", "speaker_2"})
}

func TestClauseMajoritySplitsAtSustainedUnpunctuatedTurn(t *testing.T) {
	words := []interfaces.TranscriptWord{
		clauseWord(0.2, 0.5, "一个"),
		clauseWord(0.5, 1.3, "想法"),
		clauseWord(1.3, 4.9, "就是"),
		clauseWord(5.1, 5.4, "现在"),
		clauseWord(5.4, 7.0, "开始"),
	}
	turns := []interfaces.DiarizationSegment{
		{Start: 0, End: 5.0, Speaker: "speaker_0"},
		{Start: 5.0, End: 8.0, Speaker: "speaker_3"},
	}
	assignClauseMajoritySpeakers(words, turns)
	assertClauseSpeakers(t, words, []string{"speaker_0", "speaker_0", "speaker_0", "speaker_3", "speaker_3"})
}

func TestClauseMajorityLeavesTieAndLegacyPathUntouched(t *testing.T) {
	service := &UnifiedTranscriptionService{}
	transcript := &interfaces.TranscriptResult{WordSegments: []interfaces.TranscriptWord{
		clauseWord(0, 0.5, "甲"),
		clauseWord(0.5, 1, "乙。"),
	}}
	diarization := &interfaces.DiarizationResult{Segments: []interfaces.DiarizationSegment{
		{Start: 0, End: 0.5, Speaker: "speaker_0"},
		{Start: 0.5, End: 1, Speaker: "speaker_1"},
	}}
	legacy := service.mergeDiarizationWithTranscription(transcript, diarization, false)
	assertClauseSpeakers(t, legacy.WordSegments, []string{"speaker_0", "speaker_1"})
	if _, exists := legacy.Metadata["speaker_assignment"]; exists {
		t.Fatal("legacy path must not claim clause majority assignment")
	}
	newResult := service.mergeDiarizationWithTranscription(transcript, diarization, true)
	assertClauseSpeakers(t, newResult.WordSegments, []string{"speaker_0", "speaker_1"})
	if newResult.Metadata["speaker_assignment"] != "clause_majority_v2_short_clause" {
		t.Fatal("missing assignment strategy metadata")
	}
	if transcript.WordSegments[0].Speaker != nil {
		t.Fatal("merge must not mutate the source transcript")
	}
}
