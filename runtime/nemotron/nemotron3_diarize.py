#!/usr/bin/env python3
"""Local NeMo 3 Nemotron diarization; preserve session-wide speaker IDs/seconds."""
import argparse
import json
import math
from pathlib import Path

MODEL_ID = "nvidia/Nemotron-3-Diarization"
OFFLINE_CONFIG = dict(spkcache_len=264, fifo_len=40, chunk_len=340,
                      chunk_right_context=40, spkcache_update_period=300)


def normalize_segments(rows, duration):
    """NeMo rows are absolute `start end speaker_N`, not ASR-relative times."""
    output = []
    for row in rows:
        if not isinstance(row, str) or len(row.split()) != 3:
            raise ValueError(f"Unexpected NeMo segment format: {row!r}")
        begin, end, speaker = row.split()
        begin, end = float(begin), float(end)
        if not speaker.startswith("speaker_") or not speaker[8:].isdigit():
            raise ValueError(f"Invalid speaker ID: {speaker}")
        if not 0 <= int(speaker[8:]) < 8:
            raise ValueError(f"Speaker ID exceeds model capacity: {speaker}")
        if not all(math.isfinite(t) for t in (begin, end)) or begin < 0 or end <= begin:
            raise ValueError(f"Invalid time interval: {row}")
        # NeMo rounds its last frame; permit only that small boundary overhang.
        if end > duration + 0.1 or begin >= duration:
            raise ValueError(f"Interval outside audio duration {duration}: {row}")
        end = min(end, duration)
        output.append(dict(start=begin, end=end, speaker=speaker,
                           duration=end - begin))
    output.sort(key=lambda s: (s["start"], s["end"], s["speaker"]))
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audio", nargs="?")
    parser.add_argument("output", nargs="?")
    parser.add_argument("--model", default=str(Path(__file__).with_name("Nemotron-3-Diarization.nemo")))
    parser.add_argument("--device", choices=["auto", "cuda", "cpu"], default="auto")
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    import torch
    import nemo
    import soundfile as sf
    from nemo.collections.asr.models import SortformerEncLabelModel
    if not Path(args.model).is_file():
        parser.error(f"Missing local checkpoint: {args.model}")
    if args.check:
        print(json.dumps(dict(nemo=nemo.__version__, torch=torch.__version__, model=MODEL_ID)))
        return
    if not args.audio or not args.output:
        parser.error("audio and output are required")
    info = sf.info(args.audio)
    if info.samplerate != 16000 or info.channels != 1:
        parser.error("Input must be 16 kHz mono; convert before diarization")
    device = args.device
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Loading {MODEL_ID} locally on {device}", flush=True)
    # strict=True prevents an incompatible runtime from leaving random weights.
    model = SortformerEncLabelModel.restore_from(args.model, map_location=device, strict=True)
    model.eval()
    for name, value in OFFLINE_CONFIG.items():
        setattr(model.sortformer_modules, name, value)
    model._check_streaming_parameters()
    print(f"Whole-session diarization, offline-style cache settings: {OFFLINE_CONFIG}", flush=True)
    with torch.inference_mode():
        sessions = model.diarize(audio=[args.audio], batch_size=args.batch_size)
    if len(sessions) != 1:
        raise ValueError(f"Expected one session, got {len(sessions)}")
    segments = normalize_segments(sessions[0], info.duration)
    speakers = sorted({s["speaker"] for s in segments}, key=lambda x: int(x[8:]))
    result = dict(audio_file=args.audio, model=MODEL_ID, segments=segments,
                  speakers=speakers, speaker_count=len(speakers), total_segments=len(segments),
                  total_duration=info.duration,
                  metadata=dict(timestamp_unit="seconds", timestamp_origin="full_audio",
                                max_speakers="8", confidence="not_exported",
                                inference_config=json.dumps(OFFLINE_CONFIG, sort_keys=True)))
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved {len(segments)} intervals, {len(speakers)} speaker labels", flush=True)


if __name__ == "__main__":
    main()
