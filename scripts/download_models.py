"""Download only the models used by the standard Chinese meeting pipeline."""
import argparse
import hashlib
from pathlib import Path
import shutil

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--runtime", type=Path, required=True)
parser.add_argument("--dry-run", action="store_true")
args = parser.parse_args()
runtime = args.runtime.resolve()
NEMOTRON_REVISION = "f667ed73aee57d40cc39428eb768b4fd87a0a29e"
NEMOTRON_SHA256 = "867c53f552998f772e5b5e5c082962ae85ee7ca5669c2bc17d7f615133d4e96d"
models = {
    "Qwen/Qwen3-ASR-1.7B": runtime / "qwen3-models/Qwen3-ASR-1.7B",
    "Qwen/Qwen3-ForcedAligner-0.6B": runtime / "qwen3-models/Qwen3-ForcedAligner-0.6B",
    "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch": runtime / "modelscope-cache/models/iic--speech_fsmn_vad_zh-cn-16k-common-pytorch/snapshots/master",
    "iic/speech_campplus_sv_zh-cn_16k-common": runtime / "modelscope-cache/models/iic--speech_campplus_sv_zh-cn_16k-common/snapshots/master",
}
for model, destination in models.items():
    print(f"{model} -> {destination}")
print(f"nvidia/Nemotron-3-Diarization@{NEMOTRON_REVISION} -> {runtime / 'nemotron3/Nemotron-3-Diarization.nemo'}")
if args.dry_run:
    raise SystemExit(0)

from huggingface_hub import hf_hub_download, snapshot_download as hf_snapshot
from modelscope import snapshot_download as ms_snapshot

for model, destination in models.items():
    if model.startswith("Qwen/"):
        hf_snapshot(repo_id=model, local_dir=str(destination))
    else:
        ms_snapshot(model_id=model, local_dir=str(destination))

checkpoint = Path(hf_hub_download(repo_id="nvidia/Nemotron-3-Diarization",
                               filename="Nemotron-3-Diarization.nemo",
                               revision=NEMOTRON_REVISION))
def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1048576), b""):
            h.update(block)
    return h.hexdigest()
if digest(checkpoint) != NEMOTRON_SHA256:
    raise SystemExit("Downloaded Nemotron checkpoint checksum mismatch")
target = runtime / "nemotron3/Nemotron-3-Diarization.nemo"
target.parent.mkdir(parents=True, exist_ok=True)
if target.exists():
    if digest(target) != NEMOTRON_SHA256:
        raise SystemExit("Existing Nemotron checkpoint differs; use a new runtime directory")
else:
    shutil.copy2(checkpoint, target)
print("Models downloaded; run check_runtime.py next.")
