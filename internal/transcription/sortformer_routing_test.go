package transcription

import (
	"reflect"
	"testing"

	"scriberr/internal/models"
)

func TestTopicSettingsReachSelectedNemotronAdapter(t *testing.T) {
	u := &UnifiedTranscriptionService{}
	for _, enabled := range []bool{false, true} {
		params := models.WhisperXParams{ModelFamily: FamilyFunASR, Model: "Qwen/Qwen3-ASR-1.7B", Diarize: true, DiarizeModel: DiarizeSortformer, QwenChunkManager: true, TopicMode: enabled, TopicBoundaries: []float64{2580}}
		_, diarizationID, err := u.selectModels(params)
		if err != nil {
			t.Fatal(err)
		}
		actual := u.convertParametersForModel(params, diarizationID)
		if actual["topic_mode"] != enabled || !reflect.DeepEqual(actual["topic_boundaries"], params.TopicBoundaries) {
			t.Fatalf("topic settings lost on real routing path: %#v", actual)
		}
	}
}

func TestBothNvidiaRoutes(t *testing.T) {
	service := &UnifiedTranscriptionService{}
	for _, route := range []struct{ key, adapter string }{{DiarizeSortformer, ModelSortformer}, {DiarizeSortformer4spk, ModelSortformer4spk}} {
		t.Run(route.key, func(t *testing.T) {
			for _, family := range []string{FamilyFunASR, FamilyWhisper} {
				params := models.WhisperXParams{ModelFamily: family, Model: "Qwen/Qwen3-ASR-1.7B", Diarize: true, DiarizeModel: route.key, QwenChunkManager: family == FamilyFunASR}
				transcriptionModel, diarizationModel, err := service.selectModels(params)
				if err != nil {
					t.Fatal(err)
				}
				if diarizationModel != route.adapter {
					t.Fatalf("got %s, want %s", diarizationModel, route.adapter)
				}
				if service.transcriptionIncludesDiarization(transcriptionModel, params) {
					t.Fatal("NVIDIA must run separately")
				}
				whisper := service.convertToWhisperXParams(params)
				if whisper["diarize"] != false {
					t.Fatal("WhisperX must not also diarize")
				}
				if _, ok := whisper["diarize_model"]; ok {
					t.Fatal("custom model key leaked into WhisperX")
				}
			}
		})
	}
}

func TestWhisperXUsesSeparateSortformerDiarization(t *testing.T) {
	service := &UnifiedTranscriptionService{}
	params := models.WhisperXParams{Diarize: true, DiarizeModel: DiarizeSortformer}

	transcriptionModel, diarizationModel, err := service.selectModels(params)
	if err != nil {
		t.Fatal(err)
	}
	if transcriptionModel != ModelWhisperX || diarizationModel != ModelSortformer {
		t.Fatalf("selected transcription=%q diarization=%q", transcriptionModel, diarizationModel)
	}
	if service.transcriptionIncludesDiarization(transcriptionModel, params) {
		t.Fatal("Sortformer must run after WhisperX as a separate adapter")
	}
	whisperXParams := service.convertToWhisperXParams(params)
	if whisperXParams["diarize"] != false {
		t.Fatalf("WhisperX diarize=%v; want false", whisperXParams["diarize"])
	}
	if _, exists := whisperXParams["diarize_model"]; exists {
		t.Fatal("Sortformer model ID must not be passed to WhisperX")
	}
}

func TestWhisperXKeepsIntegratedPyannoteDiarization(t *testing.T) {
	service := &UnifiedTranscriptionService{}
	params := models.WhisperXParams{Diarize: true, DiarizeModel: ModelPyannote}
	whisperXParams := service.convertToWhisperXParams(params)
	if whisperXParams["diarize"] != true || whisperXParams["diarize_model"] != ModelPyannote {
		t.Fatalf("unexpected Pyannote routing: %+v", whisperXParams)
	}
}

func TestFunASRUsesSeparateSortformerDiarization(t *testing.T) {
	service := &UnifiedTranscriptionService{}
	params := models.WhisperXParams{ModelFamily: FamilyFunASR, Device: "cuda", Diarize: true, DiarizeModel: DiarizeSortformer}
	transcriptionModel, diarizationModel, err := service.selectModels(params)
	if err != nil {
		t.Fatal(err)
	}
	if transcriptionModel != ModelFunASR || diarizationModel != ModelSortformer {
		t.Fatalf("selected transcription=%q diarization=%q", transcriptionModel, diarizationModel)
	}
	if service.transcriptionIncludesDiarization(transcriptionModel, params) {
		t.Fatal("FunASR must leave diarization to Sortformer")
	}
	modelParams := service.convertParametersForModel(params, transcriptionModel)
	if modelParams["model"] != "paraformer-zh" || modelParams["device"] != "cuda" {
		t.Fatalf("unexpected FunASR parameters: %+v", modelParams)
	}
}

func TestFunASRNativeCAMPPDoesNotRunSeparateDiarization(t *testing.T) {
	service := &UnifiedTranscriptionService{}
	params := models.WhisperXParams{ModelFamily: FamilyFunASR, Model: "paraformer-zh", Device: "cuda", Diarize: true, DiarizeModel: DiarizeFunASRCAMPP}
	transcriptionModel, diarizationModel, err := service.selectModels(params)
	if err != nil {
		t.Fatal(err)
	}
	if transcriptionModel != ModelFunASR || diarizationModel != "" {
		t.Fatalf("selected transcription=%q diarization=%q", transcriptionModel, diarizationModel)
	}
	modelParams := service.convertParametersForModel(params, transcriptionModel)
	if modelParams["native_speakers"] != true {
		t.Fatalf("native speakers not enabled: %+v", modelParams)
	}
}

func TestQwen3ASRNativeCAMPPDoesNotRunSeparateDiarization(t *testing.T) {
	service := &UnifiedTranscriptionService{}
	params := models.WhisperXParams{ModelFamily: FamilyFunASR, Model: "Qwen/Qwen3-ASR-1.7B", Device: "cuda", Diarize: true, DiarizeModel: DiarizeFunASRCAMPP}
	transcriptionModel, diarizationModel, err := service.selectModels(params)
	if err != nil {
		t.Fatal(err)
	}
	if transcriptionModel != ModelFunASR || diarizationModel != "" {
		t.Fatalf("selected transcription=%q diarization=%q", transcriptionModel, diarizationModel)
	}
	modelParams := service.convertParametersForModel(params, transcriptionModel)
	if modelParams["model"] != "Qwen/Qwen3-ASR-1.7B" || modelParams["native_speakers"] != true {
		t.Fatalf("unexpected Qwen3-ASR parameters: %+v", modelParams)
	}
}

func TestQwen3ASRExperimentalMergeUsesSeparateSortformer(t *testing.T) {
	service := &UnifiedTranscriptionService{}
	params := models.WhisperXParams{ModelFamily: FamilyFunASR, Model: "Qwen/Qwen3-ASR-1.7B", Device: "cuda", Diarize: true, DiarizeModel: DiarizeSortformer, QwenMergeVADSeconds: 15}
	transcriptionModel, diarizationModel, err := service.selectModels(params)
	if err != nil {
		t.Fatal(err)
	}
	if transcriptionModel != ModelFunASR || diarizationModel != ModelSortformer {
		t.Fatalf("selected transcription=%q diarization=%q", transcriptionModel, diarizationModel)
	}
	modelParams := service.convertParametersForModel(params, transcriptionModel)
	if modelParams["qwen_merge_vad_seconds"] != 15 || modelParams["native_speakers"] != false {
		t.Fatalf("unexpected Qwen trial parameters: %+v", modelParams)
	}
}

func TestQwenChunkManagerRoutesToSeparateSortformer(t *testing.T) {
	service := &UnifiedTranscriptionService{}
	params := models.WhisperXParams{ModelFamily: FamilyFunASR, Model: "Qwen/Qwen3-ASR-1.7B", Device: "cuda", Diarize: true, DiarizeModel: DiarizeSortformer, QwenChunkManager: true}
	transcriptionModel, diarizationModel, err := service.selectModels(params)
	if err != nil {
		t.Fatal(err)
	}
	if transcriptionModel != ModelFunASR || diarizationModel != ModelSortformer {
		t.Fatalf("selected transcription=%q diarization=%q", transcriptionModel, diarizationModel)
	}
	modelParams := service.convertParametersForModel(params, transcriptionModel)
	if modelParams["qwen_chunk_manager"] != true || modelParams["native_speakers"] != false {
		t.Fatalf("unexpected Chunk Manager routing: %+v", modelParams)
	}
}
