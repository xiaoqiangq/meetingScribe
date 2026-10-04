package transcription

import (
	"scriberr/internal/models"
	"testing"
)

func TestQwenLanguageSelectionReachesModelParameters(t *testing.T) {
	service := &UnifiedTranscriptionService{}
	for _, code := range []string{"auto", "zh", "en", "yue", "fr", "de", "it", "ja", "ko", "pt", "ru", "es"} {
		t.Run(code, func(t *testing.T) {
			params := models.WhisperXParams{Model: "Qwen/Qwen3-ASR-1.7B", Language: &code}
			got := service.convertParametersForModel(params, ModelFunASR)
			if got["language"] != code {
				t.Fatalf("language = %v; want %s", got["language"], code)
			}
		})
	}
	got := service.convertParametersForModel(models.WhisperXParams{Model: "Qwen/Qwen3-ASR-1.7B"}, ModelFunASR)
	if got["language"] != "auto" {
		t.Fatalf("missing language should enable auto: %v", got)
	}
	english := "en"
	got = service.convertParametersForModel(models.WhisperXParams{Model: "paraformer-zh", Language: &english}, ModelFunASR)
	if got["language"] != "zh" {
		t.Fatalf("Paraformer remains Chinese: %v", got)
	}
}
