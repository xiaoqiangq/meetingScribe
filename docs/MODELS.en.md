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

## Speaker identities

Nemotron emits anonymous labels, not real names. The project's native-feature extension selects clean non-overlapping audio, extracts features with the same Nemotron checkpoint, and compares them with registered audio or speakers in other topics. **TitaNet is not used in the standard pipeline.** This extension is a recommendation heuristic, not an officially evaluated NVIDIA speaker-verification head.

Long mode runs topics serially with independent caches and labels. Restoring recording timestamps does not establish identity: `topic1/speaker_0` and `topic2/speaker_0` remain separate until confirmed. The per-topic channel limit remains in force.

Usually up to five clean 3–6 second windows are selected per speaker. Enrollment accepts 10–180 seconds and recommends 20–60 seconds of clean single-speaker speech. Reference audio features are currently extracted again for each task, so larger libraries add work. Poor recording conditions and overlap reduce reliability; similarity scores are not calibrated probabilities. Renaming a mixed speaker label cannot repair its individual intervals.

## Recognition and alignment

The current bridge is configured primarily for Chinese, even though the upstream models have broader language capabilities. Alignment places supplied text on the timeline; it does not validate recognition or identify speakers. Chunk Manager typically uses 10–30 second cores with padding, midpoint deduplication and sentence-level role consolidation. No unified accuracy or real-time-factor benchmark has been completed for this integration.

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
