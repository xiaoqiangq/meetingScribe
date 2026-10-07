<p align="center"><img src="web/frontend/src/assets/meeting-assistant-waveform.jpg" width="96" alt="MeetingScribe logo"></p>

# MeetingScribe

**A self-hosted workspace for uploaded recordings and realtime microphone transcription, speaker diarization and meeting minutes.**

[简体中文](README.zh-CN.md) · [Installation](docs/INSTALL.en.md) · [Architecture](docs/ARCHITECTURE.en.md) · [Models](docs/MODELS.en.md) · [User guide](docs/USAGE.md#english-quick-guide)

Built on [Scriberr](https://github.com/rishikanthc/Scriberr). Speech recognition, diarization and native-feature matching run locally. Minutes and transcript chat use your configured local or external LLM. This repository contains source and documentation, without recordings, private voiceprints or model weights.

## Features

| Feature | Behavior |
| --- | --- |
| Interface and language | English by default; persistent English / 中文 switch; audio language chosen independently |
| Realtime microphone | Live text and session-local speaker labels; pause/resume and continuous audio/text saving |
| Short recordings | Diarize the full recording and produce timed transcripts |
| Long meetings | Manually divide topics and diarize them sequentially with independent caches |
| Speaker review | Keep topic-local labels and propose links for human confirmation |
| Name suggestions | Compare native features from the same Nemotron checkpoint against enrolled samples |
| Transcript review | Timed highlighting, playback, Listen seeking, speaker naming and exports |
| Meeting minutes | Selectable templates, sourced / clean views and generation history |
| Multiple users | Owner-based recording and minutes access; administrator account management |

## Why MeetingScribe

- **Complementary meeting models**: ASR, diarization and alignment support timed transcript review.
- **Structure-aware chunks**: Silence and speaker intervals guide cuts; context padding and core ownership preserve continuity and remove duplicates.
- **Topic-local speaker tracking**: Independent caches accommodate changing participants; recordings may exceed eight people when each topic stays within capacity.
- **Reviewable identity suggestions**: Native features from the same Nemotron checkpoint propose names and links for listening and confirmation.
- **Traceable minutes**: Sourced and clean views, selectable templates and generation history connect review with sharing.

[Strengths and practical limits](docs/ADVANTAGES.en.md) explains language support, speaker capacity, topics and performance evidence. The current bridge offers automatic detection and 11 selectable audio languages; cross-topic links require confirmation. Matched commercial comparisons have not been measured.

## Model strengths behind the workflow

| Model | Strengths | Value in MeetingScribe |
| --- | --- | --- |
| **Qwen3-ASR-1.7B** | Broad language coverage: 30 languages and 22 Chinese dialects/accents; upstream reports robustness under challenging acoustic conditions | A capable foundation for Chinese meeting transcription, including regional speech |
| **NVIDIA Nemotron-3-Diarization** | Up to eight speakers per run, overlapping-speech activity, and speaker-cache context; about 100M parameters | Timed speaker attribution without enrolling participants first; independent topic runs accommodate changing participants |
| **Qwen3-ForcedAligner-0.6B** | Aligns supplied text to audio; upstream supports 11 languages | Word/token timestamps for highlighting, Listen seeking and attribution using Nemotron intervals |
| **FSMN-VAD** | Compact speech/silence detector; deployed main weights are about 1.72 MB | Pause-aware chunk planning while preserving the original audio timeline |

[Model strengths and integration details](docs/MODELS.en.md#why-these-models) includes official sources and practical limits. The upload workflow offers auto-detection and 11 audio language choices. Realtime microphone transcription uses a separately provisioned Qwen/vLLM environment; most language choices still need individual acceptance testing.

## Realtime microphone transcription

Open **Realtime transcription**, allow microphone access, choose the input device and start recording. Text appears as you speak; the current draft can change. Confirmed text is saved before background word alignment and speaker updates complete. Pause to listen to saved audio, resume the same session, or finish and wait for final processing.

- **Shared project page:** realtime recordings appear in the project list and reuse playback, word timestamps, speaker naming, notes, exports and meeting minutes. Minutes and transcript chat become available after recording ends.
- **Readable transcripts:** upload and realtime results share paragraph and speaker-display rules. Missing labels follow the preceding display voice across fragments; original model labels and word timestamps are retained. Display attribution can be wrong when a speaker change is not recognized.
- **Continuous saving:** received audio and confirmed text are stored on the server. Closing or refreshing stops capture; unsent tail audio and the browser's temporary download copy can be lost. Reopen the saved project to review it; resuming a microphone session after closing the page is not supported.
- **Optional full-recording reprocessing:** after finishing, select **Refine with upload workflow** and a saved profile to replace the project's transcript using the complete saved recording. This is a manual action.

Microphone access requires HTTPS or localhost. One realtime session can run at a time, for up to 30 minutes, sharing GPU admission with uploaded-file transcription. Speaker numbers apply only to that session. The existing Qwen3-ASR checkpoint is reused, but vLLM, Nemotron and alignment workers need separate runtime environments. See [setup and processing details](docs/REALTIME.md). The current candidate is [v0.1.0-rc.5](https://github.com/xiaoqiangq/meetingScribe/releases/tag/v0.1.0-rc.5); fresh GPU installation, long-meeting performance and reference-scored speaker accuracy remain pending.

## Uploaded-recording processing pipeline

```text
Full recording ──┬──→ Short mode: Nemotron on the complete recording
                 │                         │
                 ├──→ Long mode: manual topic boundaries
                 │                         ↓
                 │         Run Nemotron sequentially for each topic
                 │         Independent caches and local speaker labels
                 │                         ↓
                 │         Restore full-recording timestamps
                 │         Keep topic1/speaker_0, topic2/speaker_0, ...
                 │                         │
                 │                         ├──→ Global timed intervals ─────┐
                 │                         │                                │
                 │                         └──→ Clean speaker excerpts       │
                 │                                           ↓              │
                 │                           Native Nemotron features       │
                 │                           Same checkpoint; no TitaNet    │
                 │                                           ↓              │
                 │                     Name / cross-topic link candidates   │
                 │                           Save for human confirmation    │
                 │                                                          │
                 └──→ FSMN-VAD → Speech / silence intervals ──┐             │
                                                             ↓             │
                                              Chunk Manager ←─────────────┘
                                                             ↓
                                       Continuous audio chunks + padding
                                                             ↓
                                              Qwen3-ASR transcription
                                                             ↓
                              Same audio + transcript → ForcedAligner timing
                                                             ↓
                              Timed text × Nemotron intervals → character roles
                                                             ↓
                         Core-midpoint deduplication → full-recording transcript
                                                             ↓
                  Punctuation / pauses → short-clause protection → majority speaker
                                                             ↓
                                          Transcript and speaker segments
                                                             ↓
                           Listen, confirm names / cross-topic links, then save
                                                             ↓
                                    Unified names → Playback / Listen / Export
                                                             ↓
                           Optional minutes → sourced / clean view → version history
```

Restoring the global timeline does not merge speaker identities. The same numeric label in two topics may denote different people. Topic boundaries are supplied by users; they are not automatic topic detection. The Chunk Manager plans over the full recording and does not automatically cut at every topic boundary. See [Architecture](docs/ARCHITECTURE.en.md).

## Responsibilities

| Component | Role in this application |
| --- | --- |
| Nemotron-3-Diarization | Anonymous timed speaker activity; names remain unknown |
| FSMN-VAD | Speech / silence intervals |
| Chunk Manager | Rule-based continuous chunks with context |
| Qwen3-ASR-1.7B | Audio-to-text recognition |
| Qwen3-ForcedAligner-0.6B | Align recognized text to the same audio |
| Native Nemotron feature ranking | Candidate names and cross-topic links requiring confirmation |
| Configured LLM | Minutes and transcript questions |

[Model details](docs/MODELS.en.md) cover sizes, inputs, outputs, limitations and sources. TitaNet is not used by the standard pipeline.

## Installation

```bash
git clone https://github.com/xiaoqiangq/meetingScribe.git
cd meetingScribe
```

Authenticate with your GitHub account for this private repository. Follow the [complete installation guide](docs/INSTALL.en.md): prerequisites, frontend/server build, isolated Python runtimes, model downloads, runtime checks, startup and first-run configuration.

The verified deployment uses Linux and an NVIDIA A100. The source builds for Linux amd64. Fresh-host installation steps are a reference procedure, not a completed independent clean-machine acceptance test. There is no bundled desktop installer or guaranteed CPU-only Chinese pipeline.

## Privacy and limitations

Do not commit recordings, transcripts, credentials, databases or enrolled voices. External LLM providers receive the text and speaker information submitted for minutes or chat; select a local LLM if that processing must remain local.

Diarization can split one speaker or combine several people, especially with overlap, noise or changing recording conditions. Native feature scores are not calibrated identity probabilities. The application has account isolation, but no per-user storage quota or complete GPU scheduler.

## Attribution

Scriberr's [MIT license](LICENSE) and copyright notice are retained. See [Attribution](docs/ATTRIBUTION.md). Models and dependencies retain their own licenses.

## Engineering and releases

[Docker deployment](docs/DEPLOY.en.md) · [Deployment guide](docs/DEPLOY.en.md) · [Validation status](docs/VALIDATION.en.md) · [Release policy](docs/RELEASE.en.md) · [Changelog](CHANGELOG.md)

Default Compose now builds MeetingScribe source. No stable release has passed fresh GPU acceptance yet. Model environments and weights are prepared separately. CI checks changes; tag workflows package reviewable candidates without deploying production.

## Development / 开发与目录规则

See [development workflow](docs/WORKFLOW.md) and [GPU baseline](docs/BASELINE.md). Private notes and test materials belong in `.local/` and are not uploaded to GitHub.
