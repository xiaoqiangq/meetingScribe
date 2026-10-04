# Architecture, timestamps and speaker identity

[简体中文](ARCHITECTURE.md) · [Home](../README.md)

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

## Three independent segmentation levels

| Level | Purpose | Speaker state |
| --- | --- | --- |
| Manual topic | Separate diarization sessions for changing discussions / participants | Independent process, cache and local labels |
| Internal Nemotron chunk | Run the neural model with acoustic history | Cache persists inside a topic |
| Qwen audio chunk | Bound recognition/alignment inputs | Uses the global timed speaker intervals |

Topics run sequentially. Approximately two seconds of boundary context are provided, then results are clipped to each topic's core range. Matching label suffixes across topics never imply matching identities. Short mode has no topic prefix.

## Timing and transcript assembly

Nemotron intervals are converted to full-recording seconds. FSMN-VAD intervals and speaker turns guide core chunks, typically 10–30 seconds with shorter final tails. Audio remains continuous, including silence inside a chunk. Typical padding is 0.3 seconds; forced low-energy cuts may use 0.8 seconds.

ASR and alignment consume the same padded input. Local timestamps receive the input start offset. Units are kept only when their midpoint belongs to the core, avoiding duplicate padding text. Timed words receive raw speaker roles, then punctuation/pauses and protected short clauses produce sentence-level majority assignment. Manual topic boundaries isolate sentence speaker voting.

The two input branches in the diagram describe information flow. The current adapter obtains diarization before the Qwen bridge performs VAD/chunk processing; they do not indicate parallel topic execution.

## Native-feature suggestions

Known voiceprints are not injected into Nemotron's diarization cache. After diarization, the helper selects up to five dispersed clean windows per local speaker, approximately 3–6 seconds each, excluding overlapping voices. Enrollment and meeting windows use the same checkpoint and native feature extractor, followed by pooling, normalization and similarity ranking.

Intermediate features and provenance remain in task output. The current helper re-extracts reference features from enrolled audio; it is not a fully cached vector database. Scores are uncalibrated suggestions. Users listen and explicitly save confirmed names / links. Original labels and intervals remain available. Recommendation failure preserves diarization, and new enrollment does not rewrite historical tasks or minutes.

## Minutes

Minutes use transcript text and current speaker/name information, rather than audio. Sourced views retain evidence annotations; clean views remove source statements, time labels and topic/speaker comments. Subsequent generations retain history; renaming speakers does not regenerate previous minutes.

For code locations, see the table in the [Chinese architecture document](ARCHITECTURE.md#源码定位).
