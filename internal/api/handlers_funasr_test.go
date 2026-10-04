package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"scriberr/internal/models"
)

func TestBothNvidiaChunkManagerSelectionsSurviveValidation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, key := range []string{"nvidia_sortformer", "nvidia_sortformer_4spk"} {
		ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
		ctx.Set("role", "admin")
		ctx.Set("auth_type", "jwt")
		body := fmt.Sprintf(`{"model_family":"funasr","model":"Qwen/Qwen3-ASR-1.7B","device":"cuda","diarize":true,"diarize_model":%q,"qwen_chunk_manager":true}`, key)
		ctx.Request = httptest.NewRequest(http.MethodPost, "/transcription/submit", strings.NewReader(body))
		ctx.Request.Header.Set("Content-Type", "application/json")
		params, err := (&Handler{}).getValidatedTranscriptionParams(ctx, &models.TranscriptionJob{}, "test-job")
		if err != nil {
			t.Fatal(err)
		}
		if params.DiarizeModel != key || !params.QwenChunkManager {
			t.Fatalf("selection overwritten: %+v", params)
		}
	}
}

func TestFunASRNativeSpeakerSelectionSurvivesRequestValidation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set("role", "admin")
	ctx.Set("auth_type", "jwt")
	ctx.Request = httptest.NewRequest(http.MethodPost, "/transcription/submit", strings.NewReader(`{"model_family":"funasr","model":"paraformer-zh","device":"cuda","diarize":true,"diarize_model":"funasr_campp"}`))
	ctx.Request.Header.Set("Content-Type", "application/json")

	params, err := (&Handler{}).getValidatedTranscriptionParams(ctx, &models.TranscriptionJob{}, "test-job")
	if err != nil {
		t.Fatal(err)
	}
	if params.Model != "paraformer-zh" || params.DiarizeModel != "funasr_campp" || !params.Diarize {
		t.Fatalf("FunASR CAM++ selection was overwritten: %+v", params)
	}
}

func TestFunASRSenseVoiceSelectionSurvivesRequestValidation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set("role", "admin")
	ctx.Set("auth_type", "jwt")
	ctx.Request = httptest.NewRequest(http.MethodPost, "/transcription/submit", strings.NewReader(`{"model_family":"funasr","model":"iic/SenseVoiceSmall","device":"cuda","diarize":true,"diarize_model":"nvidia_sortformer"}`))
	ctx.Request.Header.Set("Content-Type", "application/json")

	params, err := (&Handler{}).getValidatedTranscriptionParams(ctx, &models.TranscriptionJob{}, "test-job")
	if err != nil {
		t.Fatal(err)
	}
	if params.Model != "iic/SenseVoiceSmall" || params.DiarizeModel != "nvidia_sortformer" {
		t.Fatalf("SenseVoice selection was overwritten: %+v", params)
	}
}

func TestFunASRQwenCAMPPSelectionSurvivesRequestValidation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set("role", "admin")
	ctx.Set("auth_type", "jwt")
	ctx.Request = httptest.NewRequest(http.MethodPost, "/transcription/submit", strings.NewReader(`{"model_family":"funasr","model":"Qwen/Qwen3-ASR-1.7B","device":"cuda","diarize":true,"diarize_model":"funasr_campp"}`))
	ctx.Request.Header.Set("Content-Type", "application/json")

	params, err := (&Handler{}).getValidatedTranscriptionParams(ctx, &models.TranscriptionJob{}, "test-job")
	if err != nil {
		t.Fatal(err)
	}
	if params.Model != "Qwen/Qwen3-ASR-1.7B" || params.DiarizeModel != "funasr_campp" || !params.Diarize {
		t.Fatalf("Qwen3-ASR selection was overwritten: %+v", params)
	}
}

func TestFunASRQwenRejectsCPU(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set("role", "admin")
	ctx.Set("auth_type", "jwt")
	ctx.Request = httptest.NewRequest(http.MethodPost, "/transcription/submit", strings.NewReader(`{"model_family":"funasr","model":"Qwen/Qwen3-ASR-1.7B","device":"cpu"}`))
	ctx.Request.Header.Set("Content-Type", "application/json")
	if _, err := (&Handler{}).getValidatedTranscriptionParams(ctx, &models.TranscriptionJob{}, "test-job"); err == nil {
		t.Fatal("Qwen3-ASR CPU request should be rejected")
	}
}

func TestFunASRQwenAcceptsExperimentalVADMerge(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set("role", "admin")
	ctx.Set("auth_type", "jwt")
	ctx.Request = httptest.NewRequest(http.MethodPost, "/transcription/submit", strings.NewReader(`{"model_family":"funasr","model":"Qwen/Qwen3-ASR-1.7B","device":"cuda","diarize":true,"diarize_model":"nvidia_sortformer","qwen_merge_vad_seconds":15}`))
	ctx.Request.Header.Set("Content-Type", "application/json")
	params, err := (&Handler{}).getValidatedTranscriptionParams(ctx, &models.TranscriptionJob{}, "test-job")
	if err != nil {
		t.Fatal(err)
	}
	if params.QwenMergeVADSeconds != 15 || params.DiarizeModel != "nvidia_sortformer" {
		t.Fatalf("unexpected Qwen trial parameters: %+v", params)
	}
}

func TestFunASRRejectsExperimentalVADMergeForOtherModel(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set("role", "admin")
	ctx.Set("auth_type", "jwt")
	ctx.Request = httptest.NewRequest(http.MethodPost, "/transcription/submit", strings.NewReader(`{"model_family":"funasr","model":"paraformer-zh","device":"cuda","qwen_merge_vad_seconds":15}`))
	ctx.Request.Header.Set("Content-Type", "application/json")
	if _, err := (&Handler{}).getValidatedTranscriptionParams(ctx, &models.TranscriptionJob{}, "test-job"); err == nil {
		t.Fatal("experimental merge must be rejected for Paraformer")
	}
}

func TestFunASRQwenRejectsUnsupportedVADMergeDuration(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set("role", "admin")
	ctx.Set("auth_type", "jwt")
	ctx.Request = httptest.NewRequest(http.MethodPost, "/transcription/submit", strings.NewReader(`{"model_family":"funasr","model":"Qwen/Qwen3-ASR-1.7B","device":"cuda","qwen_merge_vad_seconds":60}`))
	ctx.Request.Header.Set("Content-Type", "application/json")
	if _, err := (&Handler{}).getValidatedTranscriptionParams(ctx, &models.TranscriptionJob{}, "test-job"); err == nil {
		t.Fatal("unsupported 60-second merge must be rejected")
	}
}

func TestFunASRQwenAcceptsChunkManagerWithSortformer(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set("role", "admin")
	ctx.Set("auth_type", "jwt")
	ctx.Request = httptest.NewRequest(http.MethodPost, "/transcription/submit", strings.NewReader(`{"model_family":"funasr","model":"Qwen/Qwen3-ASR-1.7B","device":"cuda","diarize":true,"diarize_model":"nvidia_sortformer","qwen_chunk_manager":true}`))
	ctx.Request.Header.Set("Content-Type", "application/json")
	params, err := (&Handler{}).getValidatedTranscriptionParams(ctx, &models.TranscriptionJob{}, "test-job")
	if err != nil {
		t.Fatal(err)
	}
	if !params.QwenChunkManager || params.DiarizeModel != "nvidia_sortformer" || params.QwenMergeVADSeconds != 0 {
		t.Fatalf("unexpected Chunk Manager parameters: %+v", params)
	}
}

func TestFunASRQwenChunkManagerRequiresSortformer(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, body := range []string{
		`{"model_family":"funasr","model":"Qwen/Qwen3-ASR-1.7B","device":"cuda","qwen_chunk_manager":true}`,
		`{"model_family":"funasr","model":"Qwen/Qwen3-ASR-1.7B","device":"cuda","diarize":true,"diarize_model":"funasr_campp","qwen_chunk_manager":true}`,
		`{"model_family":"funasr","model":"Qwen/Qwen3-ASR-1.7B","device":"cuda","diarize":true,"diarize_model":"nvidia_sortformer","qwen_merge_vad_seconds":15,"qwen_chunk_manager":true}`,
	} {
		ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
		ctx.Set("role", "admin")
		ctx.Set("auth_type", "jwt")
		ctx.Request = httptest.NewRequest(http.MethodPost, "/transcription/submit", strings.NewReader(body))
		ctx.Request.Header.Set("Content-Type", "application/json")
		if _, err := (&Handler{}).getValidatedTranscriptionParams(ctx, &models.TranscriptionJob{}, "test-job"); err == nil {
			t.Fatalf("invalid Chunk Manager request should be rejected: %s", body)
		}
	}
}

func TestQwenLanguageNotOverwrittenAtRequestBoundary(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, code := range []string{"", "auto", "zh", "en", "yue", "fr", "de", "it", "ja", "ko", "pt", "ru", "es", "ar"} {
		t.Run(code, func(t *testing.T) {
			rec := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(rec)
			ctx.Set("role", "admin")
			ctx.Set("auth_type", "jwt")
			body := fmt.Sprintf(`{"model_family":"funasr","model":"Qwen/Qwen3-ASR-1.7B","device":"cuda","language":%q}`, code)
			ctx.Request = httptest.NewRequest(http.MethodPost, "/start", strings.NewReader(body))
			ctx.Request.Header.Set("Content-Type", "application/json")
			params, err := (&Handler{}).getValidatedTranscriptionParams(ctx, &models.TranscriptionJob{}, "fixture")
			if code == "ar" {
				if err == nil || rec.Code != 400 {
					t.Fatal("unsupported alignment language must be rejected")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			want := code
			if want == "" {
				want = "auto"
			}
			if params.Language == nil || *params.Language != want {
				t.Fatalf("language=%v; want %s", params.Language, want)
			}
		})
	}
}
