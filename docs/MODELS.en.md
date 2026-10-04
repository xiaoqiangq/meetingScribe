# Models and capabilities

[中文](MODELS.md) · [Installation](INSTALL.en.md) · [Architecture](ARCHITECTURE.en.md)

## Standard pipeline

| Component | Responsibility | Input → output | Parameters / main weights |
| --- | --- | --- | --- |
| Nemotron-3-Diarization | Speaker activity and overlap | Audio → anonymous speaker intervals | ~100M / 199 MB |
| Qwen3-ASR-1.7B | Speech recognition | Audio chunks → text | 1.7B / ~4.70 GB |
| Qwen3-ForcedAligner-0.6B | Alignment of supplied text | Audio + text → word/token times | 0.6B / ~1.84 GB |
| FSMN-VAD | Speech/silence detection | Audio → intervals | ~1.72 MB in the existing deployment |
| Configured LLM | Meeting minutes | Transcript + displayed names + template → minutes | Provider dependent |

Sizes describe main weight files from the existing deployment, in decimal units. They exclude environments, CUDA and caches; they are not VRAM requirements.

## Why these models

### Qwen3-ASR-1.7B: broad speech coverage

The upstream model supports 30 languages, 22 Chinese dialects/accents and regional English accents. Qwen reports robustness on challenging acoustic inputs. Open weights enable local inference and inspection of the integration. [Official model card](https://huggingface.co/Qwen/Qwen3-ASR-1.7B)

This coverage motivates its use for Chinese meetings with regional speech. It does not establish accuracy for every dialect or recording condition. The bridge now offers automatic detection and 11 explicit languages shared by ASR and the aligner. A short English sample has passed real-model testing; other languages still need individual acceptance tests. Upstream supports offline and streaming inference, while Huiji P currently exposes uploaded-recording processing.

### NVIDIA Nemotron-3-Diarization: compact, context-aware speaker tracking

The approximately 100M-parameter model predicts anonymous speaker activity, including overlap, with up to eight channels per run. Its arrival-order speaker cache retains earlier speaker information; a FIFO queue supplies recent acoustic context. One checkpoint supports different input-buffer configurations and chunked long-audio inference. [Official model card](https://huggingface.co/nvidia/Nemotron-3-Diarization)

For Huiji P, this provides a local timeline without prior participant enrollment. Independent topic runs narrow the tracking scope when participants change. A compact checkpoint is useful in a multi-model pipeline, but parameter count and file size are not runtime VRAM requirements or speed guarantees. Upstream streaming support does not mean the website has live diarization. Original speaker labels remain anonymous until identity review.

### Qwen3-ForcedAligner-0.6B: timing separate from recognition

The aligner supports 11 languages and supplied text units within audio inputs of up to five minutes upstream. In Huiji P it receives the same short chunk used by ASR, placing recognized words/tokens on the audio timeline for highlighting and seeking. Those times also support speaker attribution and padding deduplication. [Official model card](https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B)

Keeping alignment separate lets us inspect timing independently from transcript content. It cannot correct a wrong transcription, validate a name, or resolve overlapping voices by itself.

### FSMN-VAD: a lightweight boundary signal

FSMN-VAD detects speech intervals; the deployed main weights occupy about 1.72 MB. Its speech/silence boundaries guide Chunk Manager toward pauses. The pipeline preserves silence within continuous chunks instead of concatenating speech islands, keeping timing tied to the original recording. [Model card](https://huggingface.co/funasr/fsmn-vad) · [FunASR implementation](https://github.com/modelscope/FunASR)

VAD identifies speech activity, not a speaker's identity or the meeting topic. Noise and soft speech can still affect boundaries.

### Combined value

Together, these components connect **what was said, who spoke when, and where to listen**. Chunk Manager and human identity confirmation turn their outputs into a reviewable meeting workflow. Current project validation and limitations are recorded in [Validation](VALIDATION.md); upstream metrics are not end-to-end Huiji P results.

## Speaker identities

Nemotron emits anonymous labels, not real names. The project's native-feature extension selects clean non-overlapping audio, extracts features with the same Nemotron checkpoint, and compares them with registered audio or speakers in other topics. **TitaNet is not used in the standard pipeline.** This extension is a recommendation heuristic, not an officially evaluated NVIDIA speaker-verification head.

Long mode runs topics serially with independent caches and labels. Restoring recording timestamps does not establish identity: `topic1/speaker_0` and `topic2/speaker_0` remain separate until confirmed. The per-topic channel limit remains in force.

Usually up to five clean 3–6 second windows are selected per speaker. Enrollment accepts 10–180 seconds and recommends 20–60 seconds of clean single-speaker speech. Reference audio features are currently extracted again for each task, so larger libraries add work. Poor recording conditions and overlap reduce reliability; similarity scores are not calibrated probabilities. Renaming a mixed speaker label cannot repair its individual intervals.

## Recognition and alignment

The current bridge offers auto-detection and explicit zh/en/yue/fr/de/it/ja/ko/pt/ru/es selection. New Qwen configurations default to auto; existing zh profiles remain Chinese. The Python CLI retains zh when --language is omitted for legacy compatibility. Alignment places supplied text on the timeline; it does not validate recognition or identify speakers. Chunk Manager typically uses 10–30 second cores with padding, midpoint deduplication and sentence-level role consolidation. No unified accuracy or real-time-factor benchmark has been completed for this integration.

## Optional and compatibility components

CAM++ can appear in the legacy non-Chunk-Manager path; it does not provide the standard native-feature name recommendations. WhisperX and FunASR compatibility environments are still required by adapter readiness checks. Inherited Paraformer, SenseVoice, Parakeet and Canary adapters do not imply installed or validated models. Optional cloud transcription sends audio to the configured service; external minutes providers receive transcript text and speaker information.

## Reproducibility

```text
Nemotron repository: nvidia/Nemotron-3-Diarization
revision: f667ed73aee57d40cc39428eb768b4fd87a0a29e
file: Nemotron-3-Diarization.nemo
sha256: 867c53f552998f772e5b5e5c082962ae85ee7ca5669c2bc17d7f615133d4e96d
NeMo source: 1688cc3d6a9ade854f544987810c53f605dc86fc
```

Verified bridge packages include Python 3.12, qwen-asr 0.0.6, FunASR 1.4.16, Transformers 4.57.6 and Accelerate 1.12.0. Requirements files pin core packages, not every transitive dependency. Install an official PyTorch/CUDA combination suitable for your driver. Qwen and ModelScope downloads are not revision-pinned by the helper; record their revisions and the full environment for strict reproduction.

## Upstream references and licenses

- [Nemotron model card](https://huggingface.co/nvidia/Nemotron-3-Diarization): Open Model Definition and Weights License 1.1.
- [Qwen ASR](https://huggingface.co/Qwen/Qwen3-ASR-1.7B), [ForcedAligner](https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B), [official implementation](https://github.com/QwenLM/Qwen3-ASR): model cards specify Apache-2.0.
- [FSMN-VAD](https://huggingface.co/funasr/fsmn-vad) and [FunASR](https://github.com/modelscope/FunASR).

Repository code licensing does not replace model and dependency licenses. Weights are not bundled.
