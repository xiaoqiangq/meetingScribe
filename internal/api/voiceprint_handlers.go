package api

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

//go:embed native_voiceprint_enroll.py
var nativeEnrollScript []byte

var voiceprintMu sync.Mutex
var voiceprintRunning bool

type voiceprintSample struct {
	Name        string  `json:"name"`
	Speaker     string  `json:"speaker"`
	PersonID    string  `json:"person_id"`
	File        string  `json:"file"`
	Role        string  `json:"role"`
	Start       float64 `json:"start"`
	End         float64 `json:"end"`
	AudioSHA256 string  `json:"audio_sha256"`
	FeatureFile string  `json:"feature_file,omitempty"`
	CreatedAt   string  `json:"created_at,omitempty"`
}
type voiceprintPlan struct {
	SourceJob         string             `json:"source_job"`
	SourceAudioSHA256 string             `json:"source_audio_sha256"`
	Model             string             `json:"model"`
	ModelSHA256       string             `json:"model_sha256"`
	Samples           []voiceprintSample `json:"samples"`
}
type voiceprintJob struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Status    string  `json:"status"`
	Error     string  `json:"error,omitempty"`
	CreatedAt string  `json:"created_at"`
	Duration  float64 `json:"duration_seconds,omitempty"`
}
type voiceprintPerson struct {
	ID       string             `json:"id"`
	Name     string             `json:"name"`
	Samples  []voiceprintSample `json:"samples"`
	Duration float64            `json:"duration_seconds"`
}

func writeVoiceprintJSON(path string, value interface{}) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), "manifest-")
	if err != nil {
		return err
	}
	if err = tmp.Chmod(0600); err == nil {
		_, err = tmp.Write(data)
	}
	closeErr := tmp.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(tmp.Name(), path)
}

func (h *Handler) voiceprintRoot() string {
	if root := os.Getenv("TOPIC_NATIVE_REFERENCE_ROOT"); root != "" && strings.HasPrefix(root, filepath.Dir(h.config.UploadDir)+string(os.PathSeparator)) {
		return root
	}
	return filepath.Join(filepath.Dir(h.config.UploadDir), "nemotron-voiceprints")
}

// Caller holds voiceprintMu. Existing read-only references are copied, never modified.
func (h *Handler) loadVoiceprintPlan() (voiceprintPlan, error) {
	root := h.voiceprintRoot()
	var plan voiceprintPlan
	path := filepath.Join(root, "sample-plan.json")
	if data, err := os.ReadFile(path); err == nil {
		err = json.Unmarshal(data, &plan)
		return plan, err
	} else if !os.IsNotExist(err) {
		return plan, err
	}
	for _, dir := range []string{root, filepath.Join(root, "samples"), filepath.Join(root, "jobs"), filepath.Join(root, "incoming")} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			return plan, err
		}
	}
	seed := os.Getenv("NATIVE_VOICEPRINT_SEED_ROOT")
	if seed == "" {
		seed = os.Getenv("TOPIC_NATIVE_REFERENCE_ROOT")
	}
	plan = voiceprintPlan{SourceJob: "native-managed-library", Model: "nvidia/Nemotron-3-Diarization", ModelSHA256: "867c53f552998f772e5b5e5c082962ae85ee7ca5669c2bc17d7f615133d4e96d", Samples: []voiceprintSample{}}
	if seed != "" && seed != root {
		data, err := os.ReadFile(filepath.Join(seed, "sample-plan.json"))
		if err != nil {
			return plan, err
		}
		var old voiceprintPlan
		if err = json.Unmarshal(data, &old); err != nil {
			return plan, err
		}
		plan.SourceJob = old.SourceJob
		plan.SourceAudioSHA256 = old.SourceAudioSHA256
		for _, s := range old.Samples {
			if s.Role != "reference" {
				continue
			}
			if filepath.Base(s.File) != s.File {
				return plan, fmt.Errorf("invalid seed sample path")
			}
			data, err = os.ReadFile(filepath.Join(seed, "samples", s.File))
			if err != nil {
				return plan, err
			}
			if err = os.WriteFile(filepath.Join(root, "samples", s.File), data, 0600); err != nil {
				return plan, err
			}
			plan.Samples = append(plan.Samples, s)
		}
	}
	return plan, writeVoiceprintJSON(path, plan)
}

func (h *Handler) ListVoiceprints(c *gin.Context) {
	voiceprintMu.Lock()
	defer voiceprintMu.Unlock()
	plan, err := h.loadVoiceprintPlan()
	if err != nil {
		c.JSON(500, gin.H{"error": "无法读取声纹库"})
		return
	}
	people := []voiceprintPerson{}
	index := map[string]int{}
	for _, s := range plan.Samples {
		if s.Role != "reference" {
			continue
		}
		i, ok := index[s.Name]
		if !ok {
			i = len(people)
			index[s.Name] = i
			people = append(people, voiceprintPerson{ID: s.PersonID, Name: s.Name, Samples: []voiceprintSample{}})
		}
		people[i].Samples = append(people[i].Samples, s)
		people[i].Duration += s.End - s.Start
	}
	jobs := []voiceprintJob{}
	entries, _ := os.ReadDir(filepath.Join(h.voiceprintRoot(), "jobs"))
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		data, e := os.ReadFile(filepath.Join(h.voiceprintRoot(), "jobs", entry.Name()))
		var j voiceprintJob
		if e == nil && json.Unmarshal(data, &j) == nil {
			if j.Status == "processing" && !voiceprintRunning {
				j.Status = "failed"
				j.Error = "处理曾被服务重启中断，请重新上传。"
			}
			jobs = append(jobs, j)
		}
	}
	c.JSON(200, gin.H{"people": people, "jobs": jobs, "model": plan.Model, "notice": "Nemotron 原生特征（试验）；姓名候选需人工确认。新增样本用于之后的转写，旧纪要和人物标签不自动改动。"})
}

func (h *Handler) UploadVoiceprint(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32<<20)
	if err := c.Request.ParseMultipartForm(32 << 20); err != nil {
		c.JSON(400, gin.H{"error": "上传失败：文件上限 30 MB。"})
		return
	}
	name := strings.TrimSpace(c.PostForm("name"))
	if name == "" || utf8.RuneCountInString(name) > 50 || strings.ContainsAny(name, "\r\n\x00") {
		c.JSON(400, gin.H{"error": "请填写 1–50 字的姓名。"})
		return
	}
	if c.PostForm("single_speaker") != "true" {
		c.JSON(400, gin.H{"error": "请确认录音中只有这一个人在说话。"})
		return
	}
	file, header, err := c.Request.FormFile("audio")
	if err != nil {
		c.JSON(400, gin.H{"error": "请选择录音文件。"})
		return
	}
	defer file.Close()
	if header.Size > 30<<20 {
		c.JSON(400, gin.H{"error": "录音文件不能超过 30 MB。"})
		return
	}
	voiceprintMu.Lock()
	defer voiceprintMu.Unlock()
	if voiceprintRunning {
		c.JSON(409, gin.H{"error": "正在提取声纹，请完成后再上传。"})
		return
	}
	if _, err = h.loadVoiceprintPlan(); err != nil {
		c.JSON(500, gin.H{"error": "声纹库初始化失败。"})
		return
	}
	job := voiceprintJob{ID: uuid.NewString(), Name: name, Status: "processing", CreatedAt: time.Now().UTC().Format(time.RFC3339)}
	audio := filepath.Join(h.voiceprintRoot(), "incoming", job.ID+".audio")
	out, err := os.OpenFile(audio, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		c.JSON(500, gin.H{"error": "无法保存录音。"})
		return
	}
	_, err = io.Copy(out, file)
	closeErr := out.Close()
	if err != nil || closeErr != nil {
		c.JSON(500, gin.H{"error": "保存录音失败。"})
		return
	}
	if err = writeVoiceprintJSON(filepath.Join(h.voiceprintRoot(), "jobs", job.ID+".json"), job); err != nil {
		c.JSON(500, gin.H{"error": "无法保存提取任务。"})
		return
	}
	voiceprintRunning = true
	go h.processVoiceprint(job, audio)
	c.JSON(http.StatusAccepted, job)
}

func (h *Handler) processVoiceprint(job voiceprintJob, audio string) {
	root := h.voiceprintRoot()
	runtime := filepath.Join(h.config.WhisperXEnv, "nemotron3")
	script := filepath.Join(root, "native-enroll-v1.py")
	err := os.WriteFile(script, nativeEnrollScript, 0600)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	if err == nil {
		logFile, e := os.OpenFile(filepath.Join(root, "jobs", job.ID+".log"), os.O_CREATE|os.O_WRONLY, 0600)
		if e != nil {
			err = e
		} else {
			cmd := exec.CommandContext(ctx, filepath.Join(runtime, ".venv", "bin", "python"), script, "--audio", audio, "--id", job.ID, "--output", filepath.Join(root, "samples"), "--runtime", filepath.Join(runtime, "topic-native-runtime"), "--model", filepath.Join(runtime, "Nemotron-3-Diarization.nemo"))
			cmd.Env = append(os.Environ(), "HF_HUB_OFFLINE=1", "HF_DATASETS_OFFLINE=1")
			cmd.Stdout = logFile
			cmd.Stderr = logFile
			err = cmd.Run()
			logFile.Close()
		}
	}
	voiceprintMu.Lock()
	defer voiceprintMu.Unlock()
	defer func() { voiceprintRunning = false }()
	if err == nil {
		var result struct {
			Duration float64            `json:"duration_seconds"`
			Samples  []voiceprintSample `json:"samples"`
		}
		data, e := os.ReadFile(filepath.Join(root, "samples", job.ID+"-result.json"))
		err = e
		if err == nil {
			err = json.Unmarshal(data, &result)
		}
		if err == nil && len(result.Samples) != 3 {
			err = fmt.Errorf("incomplete enrollment")
		}
		if err == nil {
			plan, e := h.loadVoiceprintPlan()
			err = e
			if err == nil {
				speaker := "enrolled_" + job.ID
				personID := uuid.NewSHA1(uuid.NameSpaceURL, []byte(plan.SourceJob+":"+speaker)).String()
				for _, s := range plan.Samples {
					if s.Name == job.Name {
						speaker = s.Speaker
						personID = s.PersonID
						break
					}
				}
				for _, s := range result.Samples {
					s.Name = job.Name
					s.Speaker = speaker
					s.PersonID = personID
					s.Role = "reference"
					s.CreatedAt = job.CreatedAt
					plan.Samples = append(plan.Samples, s)
				}
				err = writeVoiceprintJSON(filepath.Join(root, "sample-plan.json"), plan)
				job.Duration = result.Duration
			}
		}
	}
	job.Status = "ready"
	if err != nil {
		job.Status = "failed"
		job.Error = "提取失败，请上传 10–180 秒清晰的单人录音（去掉长静音），然后重试。"
	}
	_ = writeVoiceprintJSON(filepath.Join(root, "jobs", job.ID+".json"), job)
}

func (h *Handler) GetVoiceprintAudio(c *gin.Context) {
	filename := c.Param("file")
	if filepath.Base(filename) != filename || !strings.HasSuffix(filename, ".wav") {
		c.Status(404)
		return
	}
	voiceprintMu.Lock()
	plan, err := h.loadVoiceprintPlan()
	voiceprintMu.Unlock()
	if err != nil {
		c.Status(500)
		return
	}
	for _, s := range plan.Samples {
		if s.File == filename {
			c.Header("Cache-Control", "private, no-store")
			c.File(filepath.Join(h.voiceprintRoot(), "samples", filename))
			return
		}
	}
	c.Status(404)
}
