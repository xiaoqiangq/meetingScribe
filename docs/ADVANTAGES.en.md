# Huiji P: strengths and practical limits

[简体中文](ADVANTAGES.md) · [Home](../README.md) · [Full pipeline](ARCHITECTURE.en.md)

Huiji P connects transcription, speaker timelines, timed playback and meeting minutes in a reviewable workflow. It targets Chinese meetings, long recordings with changing participants, and sessions where people need to confirm speaker identities.

## 1. Complementary speech models

Qwen3-ASR-1.7B transcribes speech; Nemotron-3-Diarization supplies speaker intervals; Qwen3-ForcedAligner-0.6B aligns text with audio; FSMN-VAD locates speech and silence. Their outputs support chunk planning, timed review and speaker assignment.

Qwen officially supports 30 languages and 22 Chinese dialects or accents, including Chinese, English, Cantonese, Wu and Minnan. **The application now offers automatic detection and 11 explicit audio language choices.** A short English sample passed explicit-English and auto-detection inference; full English meetings and individual dialects have not been systematically evaluated. [Qwen model card](https://huggingface.co/Qwen/Qwen3-ASR-1.7B)

Nemotron supports up to eight speaker channels per run and overlapping speech. Its anonymous labels do not identify names. Channel capacity does not guarantee accuracy for eight participants. [NVIDIA model card](https://huggingface.co/nvidia/Nemotron-3-Diarization)

## 2. Structure-aware chunks with context

The rule-based Chunk Manager combines VAD and speaker intervals to plan typically 10–30-second cores; the final core may be shorter. It prefers silence and stable speaker changes, with low-energy cuts when necessary.

| Design | Practical value |
| --- | --- |
| Use speech and speaker boundaries | Reduce cuts within continuous speech where possible |
| Preserve internal silence and add context padding | Retain pauses and nearby context |
| Use identical chunk audio for ASR and alignment | Keep recognition and timing inputs consistent |
| Assign tokens by their midpoint within each core | Remove padding duplicates while preserving real repetitions |
| Bound individual input duration | Control input size and make local errors easier to inspect |

These are design benefits; no controlled project benchmark establishes a fixed accuracy or memory improvement. Chunk Manager does not detect speakers or topics.

## 3. Topic-local diarization for changing participants

Users supply boundaries. Nemotron runs sequentially with independent caches and labels for each topic. Cross-topic links are proposed afterward and unified only after listening and confirmation.

```text
Long meeting → Manual topic boundaries → Independent diarization
                                                  ↓
                             Preserve topic1/speaker_0, etc.
                                                  ↓
                       Propose links → Listen and confirm → Unify identities
```

This narrows the tracking scope, accommodates participant changes, prevents previous-topic cache state from carrying forward, and supports topic-level review and saved results. It aims to mitigate long-session speaker drift; the improvement needs project evaluation.

**A recording may contain more than eight distinct people if each topic remains within the model's per-run speaker capacity.** Topic 1 with A–E and topic 2 with D–I can represent nine people after confirming D and E. More than eight distinct speakers within one topic remains beyond capacity even when they take turns.

Topics are manual. Matching numeric labels across topics do not imply matching people. Boundary errors remain possible. ASR chunks are planned over the full recording and are not forced to split at every topic boundary. See [Architecture](ARCHITECTURE.en.md).

## 4. Native-feature suggestions with human confirmation

After diarization, clean original-audio segments supply features from the same Nemotron checkpoint for enrolled-name and cross-topic suggestions. The standard pipeline uses no TitaNet and does not preload enrolled voices into the diarization cache.

Original labels and intervals remain available for review. Similarity scores are not identity probabilities; this helper is not an official speaker-verification model. Listening and confirmation complete identity assignment.

## 5. Reviewable transcripts and minutes

Timed highlighting, Listen seeking, speaker naming and exports support segment review. Minutes offer selectable templates, sourced and clean views, and generation history.

Speech processing and native-feature ranking run locally. Minutes use a configured local or external LLM. External providers receive submitted text and speaker information; select a local LLM for local processing throughout.

## Evidence and performance

NVIDIA reports AliMeeting near/far DER of 6.40%/10.47% at its 30.4-second latency setting, on meetings with 2–4 speakers. These are model benchmarks, not Huiji P results or evidence of eight-person accuracy. That latency setting is not the total recording processing time. [Official evaluation](https://huggingface.co/nvidia/Nemotron-3-Diarization)

The Chinese pipeline has run on an A100 deployment. GitHub CI passes application checks and Docker builds. Whole-application speed, cross-topic accuracy and matched commercial comparisons have not been systematically measured. Independent fresh-GPU installation and business acceptance remain pending. See [Validation](VALIDATION.en.md).

**Huiji P's strength is a Chinese long-meeting workflow that combines established models with timed review, confirmed identities and minutes history.**
