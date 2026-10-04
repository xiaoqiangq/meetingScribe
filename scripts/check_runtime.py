"""Read-only checks for the standard Qwen + Nemotron web runtime."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--runtime", type=Path, required=True)
parser.add_argument("--skip-python", action="store_true", help="Check files/checkpoint only")
args = parser.parse_args()
root = args.runtime.resolve()
paths = [
    "nemotron3/.venv/bin/python", "nemotron3/Nemotron-3-Diarization.nemo",
    "nemotron3/nemotron3_diarize.py", "qwen3-asr-env/bin/python",
    "funasr-runtime/qwen3_transcribe.py", "funasr-runtime/chunk_manager.py",
    "funasr-runtime/transcribe.py", "WhisperX/.venv/bin/python",
    "qwen3-models/Qwen3-ASR-1.7B/config.json",
    "qwen3-models/Qwen3-ForcedAligner-0.6B/config.json",
    "modelscope-cache/models/iic--speech_fsmn_vad_zh-cn-16k-common-pytorch/snapshots/master/config.yaml",
    "modelscope-cache/models/iic--speech_campplus_sv_zh-cn_16k-common/snapshots/master/config.yaml",
]
paths += [f"nemotron3/topic-native-runtime/{name}.py" for name in ("native_topic_recommendations", "native_identifier", "trial")]
errors = []
for relative in paths:
    okay = (root / relative).is_file()
    print(f"{'OK' if okay else 'MISSING'} {relative}")
    if not okay:
        errors.append(relative)
for pattern in ("WhisperX/.venv/lib/python*/site-packages", "funasr-compare/lib/python*/site-packages"):
    okay = bool(list(root.glob(pattern)))
    print(f"{'OK' if okay else 'MISSING'} {pattern}")
    if not okay:
        errors.append(pattern)
checkpoint = root / "nemotron3/Nemotron-3-Diarization.nemo"
if checkpoint.is_file():
    h = hashlib.sha256()
    with checkpoint.open("rb") as stream:
        for block in iter(lambda: stream.read(1048576), b""):
            h.update(block)
    expected = "867c53f552998f772e5b5e5c082962ae85ee7ca5669c2bc17d7f615133d4e96d"
    print(f"Nemotron SHA256: {h.hexdigest()}")
    if h.hexdigest() != expected:
        errors.append("Nemotron checkpoint checksum")
if not args.skip_python:
    probes = {
        "nemotron3/.venv/bin/python": "import torch,soundfile,numpy; from nemo.collections.asr.models import SortformerEncLabelModel; print('Nemotron imports OK; CUDA:',torch.cuda.is_available()); assert torch.cuda.is_available()",
        "qwen3-asr-env/bin/python": "import torch,qwen_asr,funasr,transformers; print('Qwen imports OK; CUDA:',torch.cuda.is_available()); assert torch.cuda.is_available(); assert funasr.__version__=='1.4.16'; assert transformers.__version__=='4.57.6'",
        "WhisperX/.venv/bin/python": "import whisperx; print('WhisperX compatibility environment OK')",
    }
    for relative, code in probes.items():
        if not (root / relative).is_file():
            continue
        result = subprocess.run([str(root / relative), "-c", code], capture_output=True, text=True)
        print(result.stdout.strip())
        if result.returncode:
            print(result.stderr[-3000:])
            errors.append(f"Python import/CUDA probe: {relative}")
print(json.dumps({"ready": not errors, "errors": errors, "checks": "files/checksum/imports only; no inference performed"}))
raise SystemExit(1 if errors else 0)
