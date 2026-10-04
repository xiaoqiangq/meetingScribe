package transcription

import (
	"encoding/json"
	"fmt"
	"scriberr/internal/transcription/interfaces"
	"strings"
)

// A manual topic boundary is also a hard boundary for clause speaker voting.
// It must never merge the two independent speaker spaces across a short clause.
func assignTopicClauseSpeakers(words []interfaces.TranscriptWord, diarization *interfaces.DiarizationResult) {
	var ranges []struct {
		ID    int     `json:"id"`
		Start float64 `json:"start"`
		End   float64 `json:"end"`
	}
	if json.Unmarshal([]byte(diarization.Metadata["topic_ranges"]), &ranges) != nil {
		return
	}
	for _, topic := range ranges {
		prefix := fmt.Sprintf("topic%d/", topic.ID)
		turns := []interfaces.DiarizationSegment{}
		for _, turn := range diarization.Segments {
			if strings.HasPrefix(turn.Speaker, prefix) {
				turns = append(turns, turn)
			}
		}
		// Aligned words are chronological. Keep each topic's voting evidence separate.
		start := -1
		for i := 0; i <= len(words); i++ {
			inside := false
			if i < len(words) {
				mid := (words[i].Start + words[i].End) / 2
				inside = mid >= topic.Start && mid < topic.End
			}
			if inside && start < 0 {
				start = i
			}
			if !inside && start >= 0 {
				assignClauseMajoritySpeakers(words[start:i], turns)
				start = -1
			}
		}
	}
}
