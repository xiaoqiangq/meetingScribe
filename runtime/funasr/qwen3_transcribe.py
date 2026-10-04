"""Scriberr bridge: FunASR VAD/CAM++ with local Qwen3-ASR and ForcedAligner.

Requires the isolated qwen3-asr-env and complete local checkpoints. No audio or
text is sent to an ASR API. Existing Paraformer/SenseVoice runtimes are untouched.
"""

import argparse
import json
import math
import unicodedata
from dataclasses import asdict
from pathlib import Path
from types import SimpleNamespace

import numpy as np

from chunk_manager import Interval, plan_chunks


MODEL_ID = "Qwen/Qwen3-ASR-1.7B"
MODEL_ROOT = Path(__file__).resolve().parent.parent / "qwen3-models"
CACHE_MODELS = Path(__file__).resolve().parent.parent / "modelscope-cache" / "models"
VAD_DIR = CACHE_MODELS / "iic--speech_fsmn_vad_zh-cn-16k-common-pytorch" / "snapshots" / "master"
CAMPP_DIR = CACHE_MODELS / "iic--speech_campplus_sv_zh-cn_16k-common" / "snapshots" / "master"


def _surface_chars(text: str) -> str:
    return "".join(char for char in text if char.isalnum() or char == "_")


def _aligned_unit_positions(text: str) -> list[int]:
    """Qwen aligns Chinese by character but contiguous ASCII terms as one word."""
    positions = []
    index = 0
    while index < len(text):
        char = text[index]
        if char.isascii() and (char.isalnum() or char == "_"):
            positions.append(index)
            index += 1
            while index < len(text) and text[index].isascii() and (
                text[index].isalnum() or text[index] == "_" or
                (text[index] == "-" and index + 1 < len(text) and
                 text[index + 1].isascii() and text[index + 1].isalnum())
            ):
                index += 1
        else:
            if char.isalnum():
                positions.append(index)
            index += 1
    return positions


def _fix_funasr_timestamp_units(model) -> None:
    """Adapt qwen-asr seconds to FunASR 1.4.16's expected milliseconds.

    The upstream adapter currently calls int(ts.start_time), losing subsecond
    precision before FunASR adds VAD offsets. Keep the installed package intact
    and correct units at its qwen-asr boundary. Remove after upstream fixes it.
    """
    import funasr

    if funasr.__version__ != "1.4.16":
        raise RuntimeError("Qwen timestamp adapter needs review for this FunASR version")
    original = model.model.qwen3_asr_model.transcribe

    def transcribe_ms(*args, **kwargs):
        results = []
        for item in original(*args, **kwargs):
            if item.time_stamps is None:
                results.append(item)
                continue
            results.append(SimpleNamespace(
                text=item.text,
                language=item.language,
                time_stamps=SimpleNamespace(items=[SimpleNamespace(
                    start_time=stamp.start_time * 1000,
                    end_time=stamp.end_time * 1000,
                ) for stamp in item.time_stamps.items]),
            ))
        return results

    model.model.qwen3_asr_model.transcribe = transcribe_ms


def _returned_unit_positions(text: str, aligned_texts: list[str]) -> list[int] | None:
    """Map actual aligner units back to exact source spans, without splitting times.

    ForcedAligner keeps Unicode letters/numbers and ASCII apostrophes. Its units
    can span source punctuation (e.g. OK，OK -> OKOK). Require exact coverage;
    never guess missing characters or match only by timestamp count.
    """
    def kept(char: str) -> bool:
        return char == "'" or unicodedata.category(char)[0] in ("L", "N")

    source_positions = [index for index, char in enumerate(text) if kept(char)]
    source = "".join(text[index] for index in source_positions)
    positions = []
    cursor = 0
    for value in aligned_texts:
        unit = "".join(char for char in value if kept(char))
        if not unit or source[cursor:cursor + len(unit)] != unit:
            return None
        positions.append(source_positions[cursor])
        cursor += len(unit)
    return positions if cursor == len(source) else None


def _aligned_words(text: str, timestamps: list, speaker: str | None,
                   segment_start: float, segment_end: float,
                   aligned_texts: list[str] | None = None) -> list[dict] | None:
    """Preserve source text on model units; legacy VAD records retain old mapping."""
    positions = (_returned_unit_positions(text, aligned_texts)
                 if aligned_texts is not None else _aligned_unit_positions(text))
    if positions is None:
        return None
    if len(positions) != len(timestamps):
        return None
    if not positions:
        return None
    words = []
    last_end = segment_start
    for index, position in enumerate(positions):
        start_ms, end_ms = timestamps[index]
        start = start_ms / 1000
        end = end_ms / 1000
        if not (segment_start - 0.5 <= start <= segment_end + 0.5):
            return None
        if not (segment_start - 0.5 <= end <= segment_end + 0.5):
            return None
        if start < last_end - 0.25 or end < start:
            return None
        next_position = positions[index + 1] if index + 1 < len(positions) else len(text)
        surface = text[position:next_position]
        if index == 0:
            surface = text[:position] + surface
        if end <= start:
            next_start = (timestamps[index + 1][0] / 1000
                          if index + 1 < len(timestamps) else segment_end)
            end = min(segment_end, max(start + 0.04, next_start))
            if end <= start:
                start = max(segment_start, end - 0.04)
        word = {"start": start, "end": end, "word": surface, "score": 0.0}
        if speaker is not None:
            word["speaker"] = speaker
        words.append(word)
        last_end = end
    if "".join(word["word"] for word in words) != text:
        return None
    return words


def convert_qwen_result(item: dict, require_speakers: bool) -> dict:
    full_text = item.get("text", "")
    sentences = item.get("sentence_info") or []
    if not full_text or not sentences:
        raise RuntimeError("Qwen3-ASR returned no timestamped VAD segments")
    if _surface_chars("".join(s.get("text", "") for s in sentences)) != _surface_chars(full_text):
        raise RuntimeError("Qwen3-ASR VAD segment text does not cover the full transcript")

    segments = []
    all_words = []
    aligned = True
    for sentence in sentences:
        text = sentence.get("text", "").strip()
        if not _surface_chars(text):
            continue
        start = sentence.get("start", 0) / 1000
        end = sentence.get("end", 0) / 1000
        if end <= start:
            raise RuntimeError("Qwen3-ASR returned an invalid VAD interval")
        speaker_id = sentence.get("spk")
        if require_speakers and speaker_id is None:
            raise RuntimeError("CAM++ did not label a Qwen3-ASR speech segment")
        speaker = f"speaker_{speaker_id}" if require_speakers else None
        segment = {"start": start, "end": end, "text": text}
        if speaker is not None:
            segment["speaker"] = speaker
        segments.append(segment)

        words = _aligned_words(text, sentence.get("timestamp") or [], speaker, start, end)
        if words is None:
            aligned = False
        else:
            all_words.extend(words)

    if not segments:
        raise RuntimeError("Qwen3-ASR returned no usable speech segments")
    # Never publish a partial word timeline: it would mislead playback/highlight.
    if not aligned:
        all_words = []
    return {
        "text": full_text,
        "language": "zh",
        "segments": segments,
        "word_segments": all_words,
        "model_used": "Qwen3-ASR-1.7B + Qwen3-ForcedAligner-0.6B + fsmn-vad + cam++"
                      + (" (speakers shown)" if require_speakers else " (speakers hidden)"),
        "metadata": {"alignment": "character" if aligned else "VAD segments only"},
    }


def _quietest_cut(audio: np.ndarray, sample_rate: int):
    """Find an 80 ms low-energy point near the maximum chunk length."""
    window = max(1, round(0.08 * sample_rate))

    def select(start: float, end: float) -> float:
        left = max(0, round(start * sample_rate))
        right = min(len(audio), round(end * sample_rate))
        if right - left < window:
            return end
        # 10 ms stride keeps the search inexpensive on a long recording.
        stride = max(1, round(0.01 * sample_rate))
        best_time, best_energy = end, math.inf
        for position in range(left, right - window + 1, stride):
            frame = audio[position:position + window]
            energy = float(np.mean(frame * frame))
            if energy < best_energy:
                best_energy = energy
                best_time = (position + window // 2) / sample_rate
        return min(end, max(start, best_time))

    return select


def _save_chunk_outputs(path: Path, records: list[dict]) -> None:
    """Keep pre-filter ASR/alignment evidence, including partial failed runs."""
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps({"schema_version": 1, "chunks": records},
                                    ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def transcribe_with_chunk_manager(model, audio_path: Path, sortformer_path: Path,
                                  output_path: Path) -> dict:
    """Run full-audio VAD, plan chunks, then bypass FunASR's VAD ASR pipeline."""
    import soundfile as sf

    audio, sample_rate = sf.read(audio_path, dtype="float32")
    if audio.ndim != 1 or sample_rate != 16000:
        raise ValueError("Chunk Manager requires preprocessed mono 16 kHz WAV")
    duration = len(audio) / sample_rate
    vad_results = model.inference(str(audio_path), model=model.vad_model,
                                  kwargs=model.vad_kwargs)
    if len(vad_results) != 1:
        raise RuntimeError("FSMN-VAD did not return one result for the audio")
    vad = [Interval(start / 1000, end / 1000)
           for start, end in vad_results[0].get("value", [])]
    diarization = json.loads(sortformer_path.read_text(encoding="utf-8"))
    turns = [Interval(float(item["start"]), float(item["end"]), item["speaker"])
             for item in diarization["segments"]]
    chunks = plan_chunks(vad, turns, duration, _quietest_cut(audio, sample_rate))
    plan_path = output_path.with_name("chunk-manager-plan.json")
    plan_path.write_text(json.dumps({
        "source_audio": str(audio_path),
        "vad_intervals": [asdict(item) for item in vad],
        "chunks": [asdict(item) for item in chunks],
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    qwen = model.model.qwen3_asr_model
    segments = []
    words = []
    raw_path = output_path.with_name("qwen-chunk-outputs.json")
    raw_records = []
    for chunk in chunks:
        input_audio = audio[round(chunk.input_start * sample_rate):
                            round(chunk.input_end * sample_rate)]
        if not len(input_audio):
            raise RuntimeError(f"empty audio for chunk {chunk.index}")
        result = qwen.transcribe(audio=[(input_audio, sample_rate)], language="Chinese",
                                 return_time_stamps=True)[0]
        raw_record = {
            **asdict(chunk),
            "raw_text": result.text,
            "raw_timestamps_relative_s": [
                {"text": item.text, "start": float(item.start_time), "end": float(item.end_time)}
                for item in result.time_stamps.items
            ] if result.time_stamps is not None else None,
            "status": "recognized",
        }
        raw_records.append(raw_record)
        _save_chunk_outputs(raw_path, raw_records)
        if not result.text.strip():
            continue
        if result.time_stamps is None:
            raise RuntimeError(f"ForcedAligner returned no timestamps for chunk {chunk.index}")
        global_ms = [(round((item.start_time + chunk.input_start) * 1000),
                      round((item.end_time + chunk.input_start) * 1000))
                     for item in result.time_stamps.items]
        aligned = _aligned_words(result.text, global_ms, None,
                                 chunk.input_start, chunk.input_end,
                                 aligned_texts=[item.text for item in result.time_stamps.items])
        if aligned is None:
            raise RuntimeError(f"ForcedAligner text/timestamp mismatch in chunk {chunk.index}")
        # Core ownership, not text equality, removes duplicated padding output.
        selected = [word for word in aligned
                    if chunk.core_start <= (word["start"] + word["end"]) / 2
                    < chunk.core_end + (0.001 if chunk.index == len(chunks) else 0)]
        raw_record.update({
            "aligned_words_global_s": aligned,
            "selected_words_global_s": selected,
            "selected_text": "".join(word["word"] for word in selected),
            "status": "core_filtered",
        })
        _save_chunk_outputs(raw_path, raw_records)
        if not selected:
            continue
        segments.append({"start": selected[0]["start"], "end": selected[-1]["end"],
                         "text": "".join(word["word"] for word in selected)})
        words.extend(selected)
    if not segments or not words:
        raise RuntimeError("Chunk Manager produced no timestamped transcript")
    if any(words[index]["start"] < words[index - 1]["start"] - 0.25
           for index in range(1, len(words))):
        raise RuntimeError("Chunk Manager produced out-of-order word timestamps")
    return {
        "text": "".join(segment["text"] for segment in segments),
        "language": "zh",
        "segments": segments,
        "word_segments": words,
        "model_used": "Qwen3-ASR-1.7B + Qwen3-ForcedAligner-0.6B + FSMN-VAD + Sortformer + Chunk Manager",
        "metadata": {"alignment": "character", "chunk_manager": "speaker-aware-v1",
                     "chunk_count": str(len(chunks)), "vad_count": str(len(vad)),
                     "chunk_plan_file": "chunk-manager-plan.json",
                     "aligner_unit_mapping": "returned_text_v1",
                     "raw_chunk_outputs_file": "qwen-chunk-outputs.json"},
    }


def main() -> None:
    from funasr import AutoModel

    parser = argparse.ArgumentParser()
    parser.add_argument("audio", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--native-speakers", action="store_true")
    parser.add_argument("--merge-vad-seconds", type=int, default=0,
                        help="Experimental: merge short VAD regions before ASR (0 keeps current behavior)")
    parser.add_argument("--chunk-manager-sortformer", type=Path,
                        help="Raw Sortformer JSON; enables speaker-aware Chunk Manager")
    parser.add_argument("--debug-raw", action="store_true",
                        help="Save upstream FunASR output beside the test result")
    parser.add_argument("--model-dir", type=Path, default=MODEL_ROOT / "Qwen3-ASR-1.7B")
    parser.add_argument("--aligner-dir", type=Path,
                        default=MODEL_ROOT / "Qwen3-ForcedAligner-0.6B")
    args = parser.parse_args()
    if args.chunk_manager_sortformer and args.merge_vad_seconds:
        parser.error("Chunk Manager and FunASR merge_vad are mutually exclusive")
    if args.merge_vad_seconds < 0 or args.merge_vad_seconds > 180:
        parser.error("--merge-vad-seconds must be between 0 and 180")
    required_paths = [args.audio, args.model_dir, args.aligner_dir,
                      VAD_DIR / "config.yaml"]
    if args.chunk_manager_sortformer:
        required_paths.append(args.chunk_manager_sortformer)
    else:
        required_paths.append(CAMPP_DIR / "config.yaml")
    for path in required_paths:
        if not path.exists():
            raise FileNotFoundError(path)

    speaker_options = {} if args.chunk_manager_sortformer else {
        "spk_model": str(CAMPP_DIR), "spk_mode": "vad_segment",
    }
    model = AutoModel(
        model=MODEL_ID,
        model_conf={},
        model_path=str(args.model_dir),
        forced_aligner=str(args.aligner_dir),
        vad_model=str(VAD_DIR),
        vad_kwargs={"max_single_segment_time": 30000},
        # FunASR 1.4.16 reads merge_length_s from AutoModel.kwargs, not from
        # generate(**cfg). Keep production's default unchanged when disabled.
        merge_length_s=args.merge_vad_seconds or 15,
        # FunASR 1.4.16 only returns VAD sentence_info without ct-punc when its
        # speaker branch is enabled. Keep it on even if the UI hides speakers.
        **speaker_options,
        device="cuda",
        dtype="bf16",
        disable_update=True,
        disable_pbar=True,
    )
    if args.chunk_manager_sortformer:
        if args.native_speakers:
            parser.error("Chunk Manager uses Sortformer; CAM++ speakers are unavailable")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        result = transcribe_with_chunk_manager(model, args.audio,
                                               args.chunk_manager_sortformer, args.output)
    else:
        _fix_funasr_timestamp_units(model)
        items = model.generate(
            input=str(args.audio),
            language="zh",
            return_time_stamps=True,
            sentence_timestamp=True,
            batch_size_s=30,
            merge_vad=args.merge_vad_seconds > 0,
        )
        if len(items) != 1:
            raise RuntimeError(f"Expected one Qwen3-ASR result, got {len(items)}")
        if args.debug_raw:
            raw_path = args.output.with_suffix(".raw.json")
            raw_path.parent.mkdir(parents=True, exist_ok=True)
            raw_path.write_text(json.dumps(items[0], ensure_ascii=False), encoding="utf-8")
        result = convert_qwen_result(items[0], args.native_speakers)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
