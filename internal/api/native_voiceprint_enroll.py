"""Local Nemotron enrollment. Uses the same native feature extractor as matching."""
import argparse
import json
import subprocess
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    for name in ('audio', 'output', 'runtime', 'model', 'id'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    sys.path.insert(0, args.runtime)
    import numpy as np
    import soundfile as sf
    from native_identifier import pool_features
    from trial import load_model, sha256

    expected = '867c53f552998f772e5b5e5c082962ae85ee7ca5669c2bc17d7f615133d4e96d'
    if sha256(args.model) != expected:
        raise ValueError('Nemotron checkpoint mismatch')
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    normalized = output / (args.id + '-normalized.wav')
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'wav,mp3,mov,flac,ogg,aac', '-i', args.audio,
                    '-t', '181', '-ac', '1', '-ar', '16000', '-f', 'wav', str(normalized)], check=True)
    audio, sr = sf.read(normalized, dtype='float32')
    seconds = len(audio) / sr
    if not 10 <= seconds <= 180:
        raise ValueError('请上传 10–180 秒的单人录音，建议 20–60 秒。')
    if not np.isfinite(audio).all() or np.sqrt(np.mean(audio ** 2)) < 1e-4:
        raise ValueError('录音无效或接近静音，请使用清晰的说话录音。')
    # Three disjoint excerpts ensure a newly enrolled identity has multiple references.
    duration = min(6.0, seconds / 3)
    starts = [0.0, (seconds - duration) / 2, seconds - duration]
    clips = [audio[round(start * sr):round((start + duration) * sr)] for start in starts]
    if any(np.sqrt(np.mean(clip ** 2)) < 1e-4 for clip in clips):
        raise ValueError('部分样本接近静音，请先剪掉较长的静音区间。')
    model = load_model(Path(args.model), 'cuda')
    records = []
    for i, (start, clip) in enumerate(zip(starts, clips)):
        filename = f'{args.id}-{i}.wav'
        path = output / filename
        sf.write(path, clip, sr, subtype='PCM_16')
        # Extract from the saved PCM bytes, exactly the audio future matching reads.
        saved, saved_sr = sf.read(path, dtype='float32')
        features = pool_features(model, saved, saved_sr)
        np.savez(output / f'{args.id}-{i}.npz', **features)
        records.append(dict(file=filename, start=start, end=start + len(saved) / sr,
                            audio_sha256=sha256(path), feature_file=f'{args.id}-{i}.npz'))
    report = dict(duration_seconds=seconds, model='nvidia/Nemotron-3-Diarization',
                  model_sha256=expected, feature='Nemotron native encoder pooling',
                  identity_calibrated=False, samples=records)
    (output / (args.id + '-result.json')).write_text(json.dumps(report, ensure_ascii=False), encoding='utf-8')


if __name__ == '__main__':
    main()
