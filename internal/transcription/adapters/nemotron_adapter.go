package adapters

import (
	"context"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"scriberr/internal/transcription/interfaces"
	"scriberr/pkg/logger"
)

const nemotronModel = "nvidia/Nemotron-3-Diarization"

// Keep the existing routing ID so Qwen Chunk Manager and stored profiles work.
// The runtime lives separately from the legacy four-speaker NeMo environment.
type NemotronAdapter struct{ *SortformerAdapter }

func NewNemotronAdapter(envPath string) *NemotronAdapter {
	legacy := NewSortformerAdapter(envPath)
	legacy.capabilities.DisplayName = "NVIDIA Nemotron-3-Diarization (8 speakers)"
	legacy.capabilities.Description = "Local eight-speaker diarization with whole-session cache continuity"
	legacy.capabilities.Version = "3.0.0"
	legacy.capabilities.Metadata["license"] = "OpenMDW-1.1"
	legacy.capabilities.Metadata["model_checkpoint"] = nemotronModel
	legacy.capabilities.Metadata["optimization"] = "8_speakers"
	delete(legacy.capabilities.Features, "optimized_4_speakers")
	legacy.capabilities.Features["max_8_speakers"] = true
	for i := range legacy.schema {
		if legacy.schema[i].Name == "max_speakers" {
			legacy.schema[i].Default = 8
			legacy.schema[i].Max = &[]float64{8}[0]
			legacy.schema[i].Description = "Legacy hint only; the checkpoint always has eight speaker channels, not a forced speaker count"
		}
	}
	return &NemotronAdapter{legacy}
}

func (n *NemotronAdapter) GetMaxSpeakers() int { return 8 }

// Deployment installs a pinned runtime/checkpoint explicitly. Startup never
// upgrades shared packages or silently falls back to the old model.
func (n *NemotronAdapter) PrepareEnvironment(ctx context.Context) error {
	python := filepath.Join(n.envPath, ".venv", "bin", "python")
	script := filepath.Join(n.envPath, "nemotron3_diarize.py")
	cmd := exec.CommandContext(ctx, python, script, "--check")
	cmd.Env = append(os.Environ(), "HF_HUB_OFFLINE=1", "HF_DATASETS_OFFLINE=1")
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("Nemotron isolated runtime is not ready: %w: %s", err, output)
	}
	n.initialized = true
	return nil
}

func (n *NemotronAdapter) Diarize(ctx context.Context, input interfaces.AudioInput, params map[string]interface{}, procCtx interfaces.ProcessingContext) (*interfaces.DiarizationResult, error) {
	if enabled, _ := params["topic_mode"].(bool); enabled {
		return n.diarizeTopics(ctx, input, params, procCtx)
	}
	started := time.Now()
	if err := n.ValidateAudioInput(input); err != nil {
		return nil, err
	}
	if err := n.ValidateParameters(params); err != nil {
		return nil, err
	}
	tempDir, err := n.CreateTempDirectory(procCtx)
	if err != nil {
		return nil, err
	}
	// Retain scratch output for diagnosis; never recursively remove directories.
	audio := input
	if n.GetBoolParameter(params, "auto_convert_audio") {
		audio, err = n.ConvertAudioFormat(ctx, input, "wav", 16000)
		if err != nil {
			return nil, fmt.Errorf("Nemotron audio conversion: %w", err)
		}
	}
	batch := n.GetIntParameter(params, "batch_size")
	if batch < 1 {
		batch = 1
	}
	device := n.GetStringParameter(params, "device")
	if device == "" {
		device = "auto"
	}
	cmd := exec.CommandContext(ctx, filepath.Join(n.envPath, ".venv", "bin", "python"),
		filepath.Join(n.envPath, "nemotron3_diarize.py"), audio.FilePath,
		filepath.Join(tempDir, "result.json"), "--batch-size", strconv.Itoa(batch), "--device", device)
	cmd.Env = append(os.Environ(), "PYTHONUNBUFFERED=1", "HF_HUB_OFFLINE=1", "HF_DATASETS_OFFLINE=1")
	if scratch := procCtx.Metadata["quick_scratch"]; scratch != "" {
		cmd.Env = append(cmd.Env, "TMPDIR="+scratch, "TEMP="+scratch, "TMP="+scratch)
	}

	log, err := os.OpenFile(filepath.Join(procCtx.OutputDirectory, "transcription.log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return nil, err
	}
	defer log.Close()
	cmd.Stdout, cmd.Stderr = log, log
	logger.Info("Executing local Nemotron-3-Diarization", "job_id", procCtx.JobID)
	if err := cmd.Run(); err != nil {
		tail, _ := n.ReadLogTail(filepath.Join(procCtx.OutputDirectory, "transcription.log"), 2048)
		return nil, fmt.Errorf("Nemotron diarization failed: %w\n%s", err, tail)
	}
	result, err := n.parseNemotronJSON(tempDir)
	if err != nil {
		return nil, err
	}
	result.ProcessingTime = time.Since(started)
	result.ModelUsed = nemotronModel
	result.Metadata = n.CreateDefaultMetadata(params)
	result.Metadata["model_checkpoint"] = nemotronModel
	result.Metadata["timestamp_unit"] = "seconds"
	result.Metadata["timestamp_origin"] = "full_audio"
	result.Metadata["max_speakers"] = "8"
	result.Metadata["confidence"] = "not_exported"
	result.Metadata["inference_config"] = "offline: cache=264,fifo=40,chunk=340,right=40,update=300"
	// Topic child runs skip this stage; their combined timeline is matched once.
	skipRecommendations, _ := params["skip_name_recommendations"].(bool)
	if !skipRecommendations && os.Getenv("TOPIC_NATIVE_REFERENCE_ROOT") != "" {
		if err := n.recommendSpeakers(ctx, audio, result, procCtx, tempDir); err != nil {
			logger.Warn("Speaker recommendation setup failed", "job_id", procCtx.JobID, "error", err)
			result.Metadata["voiceprint_status"] = "failed"
		}
	}
	result.ProcessingTime = time.Since(started)
	return result, nil
}

func (n *NemotronAdapter) parseNemotronJSON(dir string) (*interfaces.DiarizationResult, error) {
	result, err := n.parseJSONResult(dir)
	if err != nil {
		return nil, err
	}
	unique := map[string]bool{}
	for i, segment := range result.Segments {
		id, err := strconv.Atoi(strings.TrimPrefix(segment.Speaker, "speaker_"))
		if err != nil || segment.Speaker != fmt.Sprintf("speaker_%d", id) || id < 0 || id >= 8 {
			return nil, fmt.Errorf("invalid Nemotron speaker: %q", segment.Speaker)
		}
		if math.IsNaN(segment.Start) || math.IsNaN(segment.End) || math.IsInf(segment.Start, 0) || math.IsInf(segment.End, 0) || segment.Start < 0 || segment.End <= segment.Start {
			return nil, fmt.Errorf("invalid Nemotron interval %d", i)
		}
		if i > 0 && segment.Start < result.Segments[i-1].Start {
			return nil, fmt.Errorf("Nemotron intervals not sorted")
		}
		unique[segment.Speaker] = true
	}
	if len(unique) != result.SpeakerCount || len(result.Speakers) != len(unique) {
		return nil, fmt.Errorf("Nemotron speaker count mismatch")
	}
	seen := map[string]bool{}
	for _, speaker := range result.Speakers {
		if !unique[speaker] || seen[speaker] {
			return nil, fmt.Errorf("Nemotron speaker list mismatch")
		}
		seen[speaker] = true
	}
	return result, nil
}
