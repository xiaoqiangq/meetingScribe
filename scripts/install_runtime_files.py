"""Install repository runtime scripts without overwriting an existing version."""
import argparse
import hashlib
from pathlib import Path
import shutil

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--runtime", type=Path, required=True)
parser.add_argument("--dry-run", action="store_true")
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
mapping = {
    "runtime/funasr/qwen3_transcribe.py": "funasr-runtime/qwen3_transcribe.py",
    "runtime/funasr/chunk_manager.py": "funasr-runtime/chunk_manager.py",
    "runtime/funasr/funasr_transcribe.py": "funasr-runtime/transcribe.py",
    "runtime/nemotron/nemotron3_diarize.py": "nemotron3/nemotron3_diarize.py",
}
for name in ("native_topic_recommendations.py", "native_identifier.py", "trial.py"):
    mapping[f"runtime/nemotron/topic-native-runtime/{name}"] = f"nemotron3/topic-native-runtime/{name}"

def digest(path):
    return hashlib.sha256(path.read_bytes()).digest()

# Validate every destination before making the first change.
for source, destination in mapping.items():
    src, dst = root / source, args.runtime / destination
    if not src.is_file():
        raise SystemExit(f"Missing source: {source}")
    if dst.exists() and (not dst.is_file() or digest(src) != digest(dst)):
        raise SystemExit(f"Existing runtime differs: {dst}. Use a new runtime directory.")
for source, destination in mapping.items():
    src, dst = root / source, args.runtime / destination
    print(f"{'CHECK' if args.dry_run else 'INSTALL'} {source} -> {dst}")
    if not args.dry_run and not dst.exists():
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
