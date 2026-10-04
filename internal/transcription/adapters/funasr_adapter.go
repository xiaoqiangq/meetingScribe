package adapters

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"scriberr/internal/transcription/interfaces"
)

// FunASRAdapter runs the local Chinese ASR pipeline in a separate Python process.
// The Python dependencies live outside WhisperX's venv and are exposed via
// PYTHONPATH, so installing FunASR does not modify the working WhisperX setup.
type FunASRAdapter struct {
	*BaseAdapter
	envPath string
}

func NewFunASRAdapter(envPath string) *FunASRAdapter {
	capabilities := interfaces.ModelCapabilities{
		ModelID:            "funasr",
		ModelFamily:        "funasr",
		DisplayName:        "FunASR Paraformer-zh",
		Description:        "Local Chinese transcription with VAD, punctuation and sentence timestamps",
		Version:            "1.4.16",
		SupportedLanguages: []string{"zh"},
		SupportedFormats:   []string{"wav"},
		RequiresGPU:        false,
		MemoryRequirement:  4096,
		Features: map[string]bool{
			"timestamps": true, "vad": true, "punctuation": true,
			"diarization": true, "word_level": false,
		},
	}
	return &FunASRAdapter{
		BaseAdapter: NewBaseAdapter("funasr", filepath.Join(envPath, "modelscope-cache"), capabilities, nil),
		envPath:     envPath,
	}
}

func (a *FunASRAdapter) GetSupportedModels() []string {
	return []string{"paraformer-zh", "iic/SenseVoiceSmall", "Qwen/Qwen3-ASR-1.7B"}
}

func (a *FunASRAdapter) qwenRuntimePaths() (python, script string, err error) {
	python = filepath.Join(a.envPath, "qwen3-asr-env", "bin", "python")
	script = filepath.Join(a.envPath, "funasr-runtime", "qwen3_transcribe.py")
	for _, path := range []string{python, script,
		filepath.Join(a.envPath, "qwen3-models", "Qwen3-ASR-1.7B", "config.json"),
		filepath.Join(a.envPath, "qwen3-models", "Qwen3-ForcedAligner-0.6B", "config.json")} {
		if _, statErr := os.Stat(path); statErr != nil {
			return "", "", fmt.Errorf("Qwen3-ASR runtime missing %s: %w", path, statErr)
		}
	}
	return python, script, nil
}

func (a *FunASRAdapter) runtimePaths() (python, packages, script string, err error) {
	python = filepath.Join(a.envPath, "WhisperX", ".venv", "bin", "python")
	script = filepath.Join(a.envPath, "funasr-runtime", "transcribe.py")
	baseMatches, baseGlobErr := filepath.Glob(filepath.Join(a.envPath, "WhisperX", ".venv", "lib", "python*", "site-packages"))
	if baseGlobErr != nil || len(baseMatches) == 0 {
		return "", "", "", fmt.Errorf("WhisperX Python packages missing under %s/WhisperX/.venv", a.envPath)
	}
	matches, globErr := filepath.Glob(filepath.Join(a.envPath, "funasr-compare", "lib", "python*", "site-packages"))
	if globErr != nil || len(matches) == 0 {
		return "", "", "", fmt.Errorf("FunASR packages missing under %s/funasr-compare", a.envPath)
	}
	// Keep torch and torchaudio from the same CUDA-enabled WhisperX environment.
	// FunASR's separate package directory also contains incompatible torch wheels.
	packages = baseMatches[0] + string(os.PathListSeparator) + matches[0]
	for _, path := range []string{python, script} {
		if _, statErr := os.Stat(path); statErr != nil {
			return "", "", "", fmt.Errorf("FunASR runtime missing %s: %w", path, statErr)
		}
	}
	return python, packages, script, nil
}

func (a *FunASRAdapter) PrepareEnvironment(_ context.Context) error {
	_, _, _, err := a.runtimePaths()
	a.initialized = err == nil
	return err
}

func (a *FunASRAdapter) IsReady(_ context.Context) bool {
	_, _, _, err := a.runtimePaths()
	return err == nil
}

func (a *FunASRAdapter) GetEstimatedProcessingTime(input interfaces.AudioInput) time.Duration {
	return 30*time.Second + input.Duration/20
}

func (a *FunASRAdapter) Transcribe(ctx context.Context, input interfaces.AudioInput, params map[string]interface{}, procCtx interfaces.ProcessingContext) (*interfaces.TranscriptResult, error) {
	started := time.Now()
	if _, err := os.Stat(input.FilePath); err != nil {
		return nil, fmt.Errorf("FunASR audio unavailable: %w", err)
	}
	if err := os.MkdirAll(procCtx.OutputDirectory, 0755); err != nil {
		return nil, err
	}

	device := "cuda"
	if value, ok := params["device"].(string); ok && value == "cpu" {
		device = "cpu"
	}
	model := "paraformer-zh"
	if value, ok := params["model"].(string); ok && value != "" {
		if value != "paraformer-zh" && value != "iic/SenseVoiceSmall" && value != "Qwen/Qwen3-ASR-1.7B" {
			return nil, fmt.Errorf("unsupported FunASR model %q", value)
		}
		model = value
	}
	qwen := model == "Qwen/Qwen3-ASR-1.7B"
	var python, packages, script string
	var err error
	if qwen {
		if device != "cuda" {
			return nil, fmt.Errorf("Qwen3-ASR-1.7B requires the CUDA runtime")
		}
		python, script, err = a.qwenRuntimePaths()
	} else {
		python, packages, script, err = a.runtimePaths()
	}
	if err != nil {
		return nil, err
	}
	output := filepath.Join(procCtx.OutputDirectory, "funasr-result.json")
	args := []string{script, input.FilePath, output}
	if !qwen {
		args = append(args, "--device", device, "--model", model)
	} else {
		chunkManager, _ := params["qwen_chunk_manager"].(bool)
		mergeSeconds, _ := params["qwen_merge_vad_seconds"].(int)
		if chunkManager {
			if mergeSeconds != 0 || nativeSpeakersEnabled(params) {
				return nil, fmt.Errorf("Qwen Chunk Manager is incompatible with VAD merge and CAM++")
			}
			plannerPath := filepath.Join(a.envPath, "funasr-runtime", "chunk_manager.py")
			if _, statErr := os.Stat(plannerPath); statErr != nil {
				return nil, fmt.Errorf("Qwen Chunk Manager planner unavailable: %w", statErr)
			}
			sortformerPath := filepath.Join(procCtx.OutputDirectory, "diarization-result.json")
			if _, statErr := os.Stat(sortformerPath); statErr != nil {
				return nil, fmt.Errorf("Qwen Chunk Manager needs raw Sortformer timeline: %w", statErr)
			}
			args = append(args, "--chunk-manager-sortformer", sortformerPath)
		} else if mergeSeconds != 0 {
			if mergeSeconds != 15 {
				return nil, fmt.Errorf("unsupported Qwen VAD merge duration %d", mergeSeconds)
			}
			args = append(args, "--merge-vad-seconds", "15")
		}
	}
	nativeSpeakers, _ := params["native_speakers"].(bool)
	if nativeSpeakers {
		if model != "paraformer-zh" && !qwen {
			return nil, fmt.Errorf("FunASR CAM++ is currently validated only with paraformer-zh or Qwen3-ASR-1.7B")
		}
		args = append(args, "--native-speakers")
	}
	cmd := exec.CommandContext(ctx, python, args...)
	cmd.Env = append(os.Environ(), "MODELSCOPE_CACHE="+filepath.Join(a.envPath, "modelscope-cache"))
	if qwen {
		cmd.Env = append(cmd.Env,
			"HF_HOME="+filepath.Join(a.envPath, "hf-cache"),
			"HF_HUB_OFFLINE=1",
			"PYTHONPATH=",
		)
	} else {
		pythonPath := packages
		if existing := os.Getenv("PYTHONPATH"); existing != "" {
			pythonPath += string(os.PathListSeparator) + existing
		}
		cmd.Env = append(cmd.Env, "PYTHONPATH="+pythonPath)
	}
	if log, err := cmd.CombinedOutput(); err != nil {
		message := string(log)
		if len(message) > 2000 {
			message = message[len(message)-2000:]
		}
		return nil, fmt.Errorf("FunASR process failed: %w: %s", err, strings.TrimSpace(message))
	}

	data, err := os.ReadFile(output)
	if err != nil {
		return nil, fmt.Errorf("FunASR result missing: %w", err)
	}
	var result interfaces.TranscriptResult
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("invalid FunASR result: %w", err)
	}
	if result.Text == "" || len(result.Segments) == 0 {
		return nil, fmt.Errorf("FunASR produced no timestamped transcript")
	}
	result.ProcessingTime = time.Since(started)
	if result.Metadata == nil {
		result.Metadata = map[string]string{}
	}
	result.Metadata["engine"] = "funasr"
	result.Metadata["model"] = model
	result.Metadata["punctuation"] = "ct-punc"
	if qwen {
		result.Metadata["punctuation"] = "Qwen3-ASR native"
		result.Metadata["aligner"] = "Qwen3-ForcedAligner-0.6B"
		if chunkManager, _ := params["qwen_chunk_manager"].(bool); chunkManager {
			result.Metadata["chunk_manager"] = "speaker-aware-v1"
			result.Metadata["engine"] = "qwen-asr direct chunks"
		}
		if mergeSeconds, ok := params["qwen_merge_vad_seconds"].(int); ok && mergeSeconds == 15 {
			result.Metadata["vad_merge"] = "15 seconds (experimental)"
		}
	}
	if nativeSpeakers {
		result.Metadata["diarization"] = "cam++ (FunASR native VAD segments)"
	}
	return &result, nil
}

func nativeSpeakersEnabled(params map[string]interface{}) bool {
	enabled, _ := params["native_speakers"].(bool)
	return enabled
}
