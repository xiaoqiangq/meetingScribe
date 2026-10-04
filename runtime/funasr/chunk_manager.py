"""Plan Qwen ASR chunks from independent VAD and Sortformer time lines.

Chunk boundaries are audio-input decisions, not transcript sentence or speaker labels.
Sortformer sustained turns are soft evidence except for a non-overlapping, sustained
speaker change; short overlapping interjections never force a cut.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable


MIN_CHUNK_S = 10.0
TARGET_CHUNK_S = 20.0
MAX_CHUNK_S = 30.0
SUSTAINED_TURN_S = 0.5
LONG_SILENCE_S = 1.5


@dataclass(frozen=True)
class Interval:
    start: float
    end: float
    speaker: str = ""


@dataclass(frozen=True)
class Candidate:
    time: float
    gap: float
    reason: str


@dataclass(frozen=True)
class Chunk:
    index: int
    core_start: float
    core_end: float
    input_start: float
    input_end: float
    cut_reason: str
    dominant_speaker: str
    speaker_overlap_s: dict[str, float]


def _check_intervals(items: list[Interval], name: str) -> list[Interval]:
    ordered = sorted(items, key=lambda item: (item.start, item.end))
    for item in ordered:
        if not all(math.isfinite(value) for value in (item.start, item.end)):
            raise ValueError(f"{name} contains a non-finite time")
        if item.start < 0 or item.end <= item.start:
            raise ValueError(f"{name} has an invalid interval: {item}")
    return ordered


def _stable_switches(turns: list[Interval]) -> list[Candidate]:
    sustained = [turn for turn in turns if turn.end - turn.start >= SUSTAINED_TURN_S]
    switches = []
    for previous, current in zip(sustained, sustained[1:]):
        if previous.speaker == current.speaker:
            continue
        # A short overlapping speaker segment is not proof of a turn hand-off.
        if previous.end > current.start + 0.3:
            continue
        switch_time = (min(previous.end, current.start) + current.start) / 2
        switches.append(Candidate(switch_time, max(0.0, current.start - previous.end),
                                  "sustained_speaker_change"))
    return switches


def _gap_candidates(vad: list[Interval]) -> list[Candidate]:
    return [Candidate((left.end + right.start) / 2,
                      max(0.0, right.start - left.end), "vad_gap")
            for left, right in zip(vad, vad[1:])]


def _speaker_overlap(start: float, end: float, turns: list[Interval]) -> dict[str, float]:
    totals: dict[str, float] = {}
    for turn in turns:
        if turn.start >= end:
            break
        overlap = max(0.0, min(end, turn.end) - max(start, turn.start))
        if overlap:
            totals[turn.speaker] = totals.get(turn.speaker, 0.0) + overlap
    return {speaker: round(duration, 3) for speaker, duration in totals.items()}


def plan_chunks(vad: list[Interval], turns: list[Interval], duration: float,
                quietest_cut: Callable[[float, float], float] | None = None) -> list[Chunk]:
    """Return non-overlapping cores plus padded audio inputs in global seconds."""
    vad = _check_intervals(vad, "VAD")
    turns = _check_intervals(turns, "Sortformer")
    if not vad:
        raise ValueError("VAD returned no speech")
    if duration < vad[-1].end - 0.05:
        raise ValueError("audio duration is shorter than the final VAD interval")
    candidates = _gap_candidates(vad)
    switches = _stable_switches(turns)
    boundaries: list[tuple[float, str, float]] = []
    start = vad[0].start
    final_end = vad[-1].end

    while True:
        limit = min(start + MAX_CHUNK_S, final_end)
        # Confirmed sustained turns keep long single-speaker reports separate.
        change = next((item for item in switches
                       if start + 0.25 < item.time < min(limit, final_end - 0.25)), None)
        if change is not None:
            cut = change.time
            reason = change.reason
            gap = change.gap
        elif final_end - start <= MAX_CHUNK_S:
            boundaries.append((final_end, "audio_end", 0.0))
            break
        else:
            nearby = [item for item in candidates if start + MIN_CHUNK_S <= item.time <= limit]
            natural = [item for item in nearby if item.gap >= LONG_SILENCE_S]
            if natural:
                chosen = natural[0]
            elif nearby:
                chosen = max(nearby, key=lambda item: (
                    min(item.gap, 1.5) * 4
                    - abs(item.time - (start + TARGET_CHUNK_S)) * 0.18,
                    -item.time,
                ))
            else:
                chosen = None
            if chosen is not None:
                cut, reason, gap = chosen.time, ("long_silence" if chosen.gap >= LONG_SILENCE_S
                                                  else "vad_gap"), chosen.gap
            else:
                search_start = max(start + MIN_CHUNK_S, limit - 4)
                cut = quietest_cut(search_start, limit) if quietest_cut else limit
                reason, gap = "forced_low_energy", 0.0
        if not start < cut <= limit:
            raise ValueError(f"invalid chunk cut {cut} from {start}")
        boundaries.append((cut, reason, gap))
        start = cut

    chunks = []
    core_start = vad[0].start
    for index, (core_end, reason, gap) in enumerate(boundaries, 1):
        if core_end <= core_start:
            raise ValueError("chunk cores are not strictly increasing")
        # Longer context is reserved for a forced cut through continuous speech.
        left_padding = 0.8 if index > 1 and boundaries[index - 2][1] == "forced_low_energy" else 0.3
        right_padding = 0.8 if reason == "forced_low_energy" else 0.3
        overlap = _speaker_overlap(core_start, core_end, turns)
        dominant = max(overlap, key=overlap.get) if overlap else ""
        chunks.append(Chunk(index, core_start, core_end,
                            max(0.0, core_start - left_padding), min(duration, core_end + right_padding),
                            reason, dominant, overlap))
        core_start = core_end
    return chunks


def _read_csv(path: Path, kind: str) -> list[Interval]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        rows = csv.DictReader(handle)
        return [Interval(float(row["start_s"]), float(row["end_s"]),
                         row.get("speaker", "") if kind == "sortformer" else "")
                for row in rows]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vad-csv", type=Path, required=True)
    parser.add_argument("--sortformer-csv", type=Path, required=True)
    parser.add_argument("--duration", type=float, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    chunks = plan_chunks(_read_csv(args.vad_csv, "vad"),
                         _read_csv(args.sortformer_csv, "sortformer"), args.duration)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps([asdict(chunk) for chunk in chunks], ensure_ascii=False,
                                      indent=2), encoding="utf-8")
    csv_path = args.output.with_suffix(".csv")
    with csv_path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=["index", "core_start_s", "core_end_s",
                                                   "core_duration_s", "input_start_s", "input_end_s",
                                                   "cut_reason", "dominant_speaker",
                                                   "speaker_overlap_s", "review_mixed_speakers"])
        writer.writeheader()
        for chunk in chunks:
            durations = sorted(chunk.speaker_overlap_s.values(), reverse=True)
            writer.writerow({
                "index": chunk.index,
                "core_start_s": f"{chunk.core_start:.3f}",
                "core_end_s": f"{chunk.core_end:.3f}",
                "core_duration_s": f"{chunk.core_end-chunk.core_start:.3f}",
                "input_start_s": f"{chunk.input_start:.3f}",
                "input_end_s": f"{chunk.input_end:.3f}",
                "cut_reason": chunk.cut_reason,
                "dominant_speaker": chunk.dominant_speaker,
                "speaker_overlap_s": json.dumps(chunk.speaker_overlap_s, ensure_ascii=False),
                "review_mixed_speakers": len(durations) > 1 and durations[1] >= 2,
            })
    print(f"planned {len(chunks)} chunks -> {args.output}, {csv_path}")


if __name__ == "__main__":
    main()
