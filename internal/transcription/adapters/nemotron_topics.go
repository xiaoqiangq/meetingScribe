package adapters

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"scriberr/internal/models"
	"scriberr/internal/transcription/interfaces"
	"scriberr/pkg/logger"
)

type topicRange struct {
	ID    int     `json:"id"`
	Start float64 `json:"start"`
	End   float64 `json:"end"`
}

func (n *NemotronAdapter) diarizeTopics(ctx context.Context, input interfaces.AudioInput, params map[string]interface{}, procCtx interfaces.ProcessingContext) (*interfaces.DiarizationResult, error) {
	started := time.Now()
	if err := n.ValidateAudioInput(input); err != nil {
		return nil, err
	}
	points, ok := params["topic_boundaries"].([]float64)
	if !ok {
		return nil, fmt.Errorf("invalid topic boundaries type")
	}
	probe := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", input.FilePath)
	raw, err := probe.Output()
	if err != nil {
		return nil, fmt.Errorf("topic duration probe: %w", err)
	}
	duration, err := strconv.ParseFloat(strings.TrimSpace(string(raw)), 64)
	if err != nil || duration <= 0 || math.IsInf(duration, 0) || math.IsNaN(duration) {
		return nil, fmt.Errorf("invalid audio duration")
	}
	if err := models.ValidateTopicBoundaries(points, duration); err != nil {
		return nil, err
	}
	scratch, err := n.CreateTempDirectory(procCtx)
	if err != nil {
		return nil, err
	}
	scratch, err = os.MkdirTemp(scratch, "topic-run-")
	if err != nil {
		return nil, err
	}
	cuts := append(append([]float64{0}, points...), duration)
	result := &interfaces.DiarizationResult{ModelUsed: nemotronModel, Metadata: n.CreateDefaultMetadata(params)}
	speakers := map[string]bool{}
	topics := []topicRange{}
	childParams := map[string]interface{}{}
	for k, v := range params {
		if k != "topic_mode" && k != "topic_boundaries" {
			childParams[k] = v
		}
	}
	childParams["auto_convert_audio"] = false
	childParams["skip_name_recommendations"] = true
	for i := 0; i < len(cuts)-1; i++ {
		begin, end := cuts[i], cuts[i+1]
		topics = append(topics, topicRange{i + 1, begin, end})
		// Carry a little acoustic context across the cut, but crop predictions to
		// the topic. A separate Python invocation guarantees a fresh speaker cache.
		contextStart, contextEnd := math.Max(0, begin-2), math.Min(duration, end+2)
		clip := filepath.Join(scratch, fmt.Sprintf("topic-%d.wav", i+1))
		cmd := exec.CommandContext(ctx, "ffmpeg", "-nostdin", "-n", "-v", "error", "-ss", fmt.Sprint(contextStart), "-i", input.FilePath, "-t", fmt.Sprint(contextEnd-contextStart), "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", clip)
		if log, err := cmd.CombinedOutput(); err != nil {
			return nil, fmt.Errorf("topic %d extraction: %w: %s", i+1, err, log)
		}
		clipInfo, err := os.Stat(clip)
		if err != nil {
			return nil, err
		}
		child := procCtx
		child.JobID = fmt.Sprintf("%s-topic-%d", procCtx.JobID, i+1)
		diarized, err := n.Diarize(ctx, interfaces.AudioInput{FilePath: clip, Size: clipInfo.Size(), Format: "wav", SampleRate: 16000, Channels: 1, Duration: time.Duration((contextEnd - contextStart) * float64(time.Second))}, childParams, child)
		if err != nil {
			return nil, fmt.Errorf("topic %d: %w", i+1, err)
		}
		for _, segment := range diarized.Segments {
			segment.Start = math.Max(begin, segment.Start+contextStart)
			segment.End = math.Min(end, segment.End+contextStart)
			if segment.End <= segment.Start {
				continue
			}
			segment.Speaker = fmt.Sprintf("topic%d/%s", i+1, segment.Speaker)
			result.Segments = append(result.Segments, segment)
			speakers[segment.Speaker] = true
		}
	}
	for speaker := range speakers {
		result.Speakers = append(result.Speakers, speaker)
	}
	sort.Strings(result.Speakers)
	result.SpeakerCount = len(speakers)
	result.ProcessingTime = time.Since(started)
	topicJSON, _ := json.Marshal(topics)
	result.Metadata["topic_ranges"] = string(topicJSON)
	result.Metadata["topic_mode"] = "independent_cache"
	result.Metadata["timestamp_origin"] = "full_audio"
	result.Metadata["max_speakers_per_topic"] = "8"
	result.Metadata["confidence"] = "not_exported"
	if err := n.recommendSpeakers(ctx, input, result, procCtx, scratch); err != nil {
		logger.Warn("Speaker recommendation setup failed", "job_id", procCtx.JobID, "error", err)
		result.Metadata["voiceprint_status"] = "failed"
	}
	return result, nil
}

func (n *NemotronAdapter) recommendSpeakers(ctx context.Context, input interfaces.AudioInput, result *interfaces.DiarizationResult, procCtx interfaces.ProcessingContext, scratch string) error {
	// Optional read-only library matching. Its failure must not discard diarization.
	resultPath := filepath.Join(scratch, "topics-diarization.json")
	encoded, err := json.Marshal(result)
	if err != nil {
		return err
	}
	if err := os.WriteFile(resultPath, encoded, 0600); err != nil {
		return err
	}
	nativeRoot := os.Getenv("TOPIC_NATIVE_REFERENCE_ROOT")
	if library := os.Getenv("TOPIC_VOICEPRINT_LIBRARY"); nativeRoot != "" || library != "" {
		output := filepath.Join(procCtx.OutputDirectory, "topic-recommendations.json")
		args := []string{filepath.Join(n.envPath, "topic_voiceprints.py"), "--audio", input.FilePath, "--diarization", resultPath, "--library", library, "--model", os.Getenv("TOPIC_VOICEPRINT_MODEL"), "--output", output}
		nativeOutput := ""
		if nativeRoot != "" {
			nativeOutput, err = os.MkdirTemp(procCtx.OutputDirectory, "topic-native-")
			if err != nil {
				return err
			}
			args = []string{filepath.Join(n.envPath, "topic-native-runtime", "native_topic_recommendations.py"), "--audio", input.FilePath, "--diarization", resultPath,
				"--model", filepath.Join(n.envPath, "Nemotron-3-Diarization.nemo"), "--plan", filepath.Join(nativeRoot, "sample-plan.json"), "--samples", filepath.Join(nativeRoot, "samples"), "--output", nativeOutput}
			result.Metadata["voiceprint_model"] = "nemotron_native_experimental"
		}
		match := exec.CommandContext(ctx, filepath.Join(n.envPath, ".venv", "bin", "python"), args...)
		match.Env = append(os.Environ(), "HF_HUB_OFFLINE=1", "HF_DATASETS_OFFLINE=1")
		log, matchErr := match.CombinedOutput()
		if matchErr == nil && nativeOutput != "" {
			var report []byte
			report, matchErr = os.ReadFile(filepath.Join(nativeOutput, "topic-recommendations.json"))
			if matchErr == nil {
				matchErr = os.WriteFile(output, report, 0600)
			}
		}
		if matchErr != nil {
			logger.Warn("Topic voiceprint recommendations failed", "job_id", procCtx.JobID, "error", matchErr, "output", string(log))
			result.Metadata["voiceprint_status"] = "failed"
			// Replace any stale report from an earlier run with an explicit notice.
			notice, _ := json.Marshal(map[string]interface{}{"speakers": []interface{}{}, "links": []interface{}{}, "notice": "声纹推荐生成失败；分人结果已保留。"})
			_ = os.WriteFile(output, notice, 0600)
		} else {
			result.Metadata["voiceprint_status"] = "suggestions_only"
		}
	}
	return nil
}
