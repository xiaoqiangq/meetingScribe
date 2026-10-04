package transcription

import (
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	"scriberr/internal/transcription/interfaces"
)

const (
	// A pause ends a spoken clause even when ASR omits punctuation.
	clausePauseSeconds = 0.8
	// Short acknowledgements do not force a cut through an otherwise continuous clause.
	stableSpeakerTurnSeconds = 2.0
	shortClauseMaxSeconds    = 5.0
	shortClauseMaxHanChars   = 30
)

// assignClauseMajoritySpeakers labels a whole spoken clause from the accumulated
// overlap of its aligned words with Sortformer. It only runs for the opt-in
// Qwen Chunk Manager path; older transcription modes retain word-by-word labels.
func assignClauseMajoritySpeakers(words []interfaces.TranscriptWord, turns []interfaces.DiarizationSegment) {
	if len(words) == 0 || len(turns) == 0 {
		return
	}
	onsets := sustainedSpeakerChangeOnsets(turns)
	start := 0
	for index, word := range words {
		if index > start {
			previous := words[index-1]
			if word.Start-previous.End >= clausePauseSeconds {
				assignNaturalClauseSpeakers(words[start:index], turns, onsets)
				start = index
			}
		}
		if endsSpokenClause(word.Word) {
			assignNaturalClauseSpeakers(words[start:index+1], turns, onsets)
			start = index + 1
		}
	}
	if start < len(words) {
		assignNaturalClauseSpeakers(words[start:], turns, onsets)
	}
}

// Natural punctuation/pause boundaries are established on the global word
// stream first. A sustained onset must not split a short clause (even across
// ASR chunks). Long clauses retain the old onset split as a conservative fallback;
// any punctuation or >=0.8s pause has already supplied a natural boundary.
func assignNaturalClauseSpeakers(words []interfaces.TranscriptWord, turns []interfaces.DiarizationSegment, onsets []float64) {
	if len(words) == 0 {
		return
	}
	hanChars := 0
	for _, word := range words {
		for _, char := range word.Word {
			if unicode.Is(unicode.Han, char) {
				hanChars++
			}
		}
	}
	if words[len(words)-1].End-words[0].Start <= shortClauseMaxSeconds && hanChars <= shortClauseMaxHanChars {
		assignClauseSpeaker(words, turns)
		return
	}
	start := 0
	for index := 1; index < len(words); index++ {
		previousMid := (words[index-1].Start + words[index-1].End) / 2
		currentMid := (words[index].Start + words[index].End) / 2
		if crossesSpeakerOnset(previousMid, currentMid, onsets) {
			assignClauseSpeaker(words[start:index], turns)
			start = index
		}
	}
	assignClauseSpeaker(words[start:], turns)
}

func endsSpokenClause(value string) bool {
	value = strings.TrimRight(value, " \t\r\n\"'”’）】")
	last, _ := utf8.DecodeLastRuneInString(value)
	return strings.ContainsRune("，,。.!?！？；;…", last)
}

func sustainedSpeakerChangeOnsets(turns []interfaces.DiarizationSegment) []float64 {
	ordered := append([]interfaces.DiarizationSegment(nil), turns...)
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].Start < ordered[j].Start })
	stable := make([]interfaces.DiarizationSegment, 0, len(ordered))
	for _, turn := range ordered {
		if turn.End-turn.Start >= stableSpeakerTurnSeconds {
			stable = append(stable, turn)
		}
	}
	onsets := make([]float64, 0, len(stable))
	for index := 1; index < len(stable); index++ {
		if stable[index].Speaker != stable[index-1].Speaker {
			onsets = append(onsets, stable[index].Start)
		}
	}
	return onsets
}

func crossesSpeakerOnset(previousMid, currentMid float64, onsets []float64) bool {
	for _, onset := range onsets {
		if previousMid < onset && onset <= currentMid {
			return true
		}
	}
	return false
}

func assignClauseSpeaker(words []interfaces.TranscriptWord, turns []interfaces.DiarizationSegment) {
	totals := make(map[string]float64)
	total := 0.0
	for _, word := range words {
		if word.End <= word.Start {
			continue
		}
		for _, turn := range turns {
			overlap := min(word.End, turn.End) - max(word.Start, turn.Start)
			if overlap > 0 {
				totals[turn.Speaker] += overlap
				total += overlap
			}
		}
	}
	bestSpeaker := ""
	bestOverlap := 0.0
	for speaker, overlap := range totals {
		if overlap > bestOverlap {
			bestSpeaker, bestOverlap = speaker, overlap
		}
	}
	// A tie or uncovered clause has no defensible majority. Keep the original
	// word-level evidence instead of silently inventing a speaker.
	if bestSpeaker == "" || bestOverlap <= total/2+1e-6 {
		return
	}
	for index := range words {
		speaker := bestSpeaker
		words[index].Speaker = &speaker
	}
}
