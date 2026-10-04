"""Scriberr bridge for local FunASR models + VAD + punctuation.

The caller supplies a 16 kHz mono WAV and an output path. This script does not
modify Scriberr's database or send audio to an external ASR service.
"""

import argparse
import json
import re
from pathlib import Path

def convert_result(item: dict) -> dict:
    # FunASR's sentence_info timestamps can drift far from its text on long
    # recordings. Its top-level raw_text tokens and timestamp entries remain
    # one-to-one; sentence_info.raw_text partitions those same tokens exactly.
    tokens = item.get("raw_text", "").split()
    timestamps = item.get("timestamp", [])
    if not tokens or len(tokens) != len(timestamps):
        raise RuntimeError("FunASR raw tokens and timestamps do not match")

    segments = []
    token_index = 0
    for sentence in item.get("sentence_info", []):
        raw = sentence.get("raw_text", "")
        if not raw:
            continue
        first_token = token_index
        assembled = ""
        while len(assembled) < len(raw) and token_index < len(tokens):
            assembled += tokens[token_index]
            token_index += 1
        if assembled != raw:
            raise RuntimeError(f"FunASR sentence/token mismatch at token {first_token}")

        text = sentence.get("text", "").strip()
        start = timestamps[first_token][0]
        end = timestamps[token_index - 1][1]
        if re.search(r"[\w\u4e00-\u9fff]", text) and end > start:
            segments.append({"start": start / 1000, "end": end / 1000, "text": text})

    if token_index != len(tokens):
        raise RuntimeError("FunASR did not assign every raw token to a sentence")

    if not segments:
        raise RuntimeError("FunASR returned no sentence timestamps")

    return {
        "text": item.get("text", ""),
        "language": "zh",
        "segments": segments,
        "model_used": "paraformer-zh + fsmn-vad + ct-punc (token-aligned timestamps)",
    }


def convert_sensevoice_result(item: dict) -> dict:
    words = item.get("words", [])
    timestamps = item.get("timestamp", [])
    sentences = item.get("sentence_info", [])
    if not words or len(words) != len(timestamps) or not sentences:
        raise RuntimeError("SenseVoice words, timestamps or sentences are unavailable")

    segments = []
    word_index = 0
    for sentence in sentences:
        raw = re.sub(r"\s+", "", sentence.get("raw_text", ""))
        if not raw:
            continue
        first_word = word_index
        assembled = ""
        while len(assembled) < len(raw) and word_index < len(words):
            assembled += re.sub(r"\s+", "", words[word_index])
            word_index += 1
        if assembled != raw:
            raise RuntimeError(f"SenseVoice sentence/word mismatch at word {first_word}")
        start, end = timestamps[first_word][0], timestamps[word_index - 1][1]
        text = sentence.get("text", "").strip()
        if re.search(r"[\w\u4e00-\u9fff]", text) and end > start:
            segments.append({"start": start / 1000, "end": end / 1000, "text": text})

    if word_index != len(words) or not segments:
        raise RuntimeError("SenseVoice did not assign every word to a sentence")
    return {
        "text": item.get("text", ""),
        "language": "zh",
        "segments": segments,
        "model_used": "SenseVoiceSmall + fsmn-vad + ct-punc (word-aligned timestamps)",
    }


def convert_native_speaker_result(item: dict, model_name: str) -> dict:
    """Keep FunASR's own VAD/CAM++ timing and restore its punctuated surface text."""
    full_text = item.get("text", "")
    sentences = item.get("sentence_info", [])
    word_positions = [i for i, char in enumerate(full_text) if char.isalnum() or char == "_"]
    normalize = lambda value: "".join(char for char in value if char.isalnum() or char == "_")
    if not full_text or not sentences or not word_positions:
        raise RuntimeError("FunASR native speaker result is empty")
    if normalize("".join(sentence.get("text", "") for sentence in sentences)) != normalize(full_text):
        raise RuntimeError("FunASR native speaker text does not match punctuated full text")

    segments = []
    char_cursor = 0
    word_cursor = 0
    for sentence in sentences:
        raw = normalize(sentence.get("text", ""))
        if not raw:
            continue
        word_cursor += len(raw)
        end_cursor = word_positions[word_cursor] if word_cursor < len(word_positions) else len(full_text)
        text = full_text[char_cursor:end_cursor].strip()
        if normalize(text) != raw:
            raise RuntimeError("FunASR native speaker segment text mismatch")
        char_cursor = end_cursor

        start = sentence.get("start", 0)
        end = sentence.get("end", 0)
        speaker = sentence.get("spk")
        if end <= start or speaker is None:
            raise RuntimeError("FunASR native speaker segment lacks time or speaker")
        segments.append({
            "start": start / 1000,
            "end": end / 1000,
            "text": text,
            "speaker": f"speaker_{speaker}",
        })
    if word_cursor != len(word_positions) or not segments:
        raise RuntimeError("FunASR native speaker result is incomplete")
    return {
        "text": full_text,
        "language": "zh",
        "segments": segments,
        "model_used": f"{model_name} + fsmn-vad + ct-punc + cam++ (native VAD speaker segments)",
    }


def main() -> None:
    from funasr import AutoModel

    parser = argparse.ArgumentParser()
    parser.add_argument("audio", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cuda")
    parser.add_argument("--model", choices=("paraformer-zh", "iic/SenseVoiceSmall"), default="paraformer-zh")
    parser.add_argument("--native-speakers", action="store_true")
    args = parser.parse_args()

    model = AutoModel(
        model=args.model,
        vad_model="fsmn-vad",
        punc_model="ct-punc",
        **({"spk_model": "cam++", "spk_mode": "vad_segment"} if args.native_speakers else {}),
        device=args.device,
        disable_update=True,
    )
    options = {"input": str(args.audio), "batch_size_s": 300, "return_raw_text": True}
    if not args.native_speakers:
        options["sentence_timestamp"] = True
        if args.model == "iic/SenseVoiceSmall":
            options["output_timestamp"] = True
    items = model.generate(**options)
    if not items:
        raise RuntimeError("FunASR returned an empty result")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.native_speakers:
        result = convert_native_speaker_result(items[0], args.model)
    else:
        convert = convert_sensevoice_result if args.model == "iic/SenseVoiceSmall" else convert_result
        result = convert(items[0])
    args.output.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
