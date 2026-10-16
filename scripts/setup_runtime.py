"""Prepare the upload-transcription runtime inside a fresh CUDA container.

Successful dependency stages are retained for retries. Existing environments
not owned by this installer are refused; nothing is removed or cleared.
"""
import argparse
import fcntl
import hashlib
import json
from pathlib import Path
import shlex
import subprocess
import sys


SOURCE = Path(__file__).resolve().parent.parent
TORCH_INDEX = "https://download.pytorch.org/whl/cu126"


def stages(runtime):
    result = []
    for name, requirements in (
        ("qwen3-asr-env", "requirements-qwen.txt"),
        ("nemotron3/.venv", "requirements-nemotron.txt"),
        ("funasr-compare", None),
    ):
        env = runtime / name
        python = str(env / "bin/python")
        result.append((name + ":venv", [sys.executable, "-m", "venv", str(env)]))
        result.append((name + ":tools", [python, "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel", "Cython", "packaging"]))
        if requirements:
            result.append((name + ":torch", [python, "-m", "pip", "install", "torch", "torchaudio", "--index-url", TORCH_INDEX]))
            packages = ["-r", str(SOURCE / "runtime" / requirements)]
        else:
            packages = ["funasr==1.4.16", "kaldi-native-fbank==1.22.3"]
        result.append((name + ":packages", [python, "-m", "pip", "install", *packages]))
        result.append((name + ":check", [python, "-m", "pip", "check"]))
    # These legacy environments are still required by the Go adapter's checks.
    project = str(runtime / "WhisperX")
    result.append(("WhisperX:init", ["uv", "init", "--bare", "--python", "3.12", project]))
    result.append(("WhisperX:packages", ["uv", "add", "--native-tls", "--project", project, "whisperx==3.8.7rc1"]))
    return result


def run(command):
    print("+ " + shlex.join(map(str, command)), flush=True)
    subprocess.run(command, check=True)


def prepare(runtime):
    if sys.version_info[:2] != (3, 12):
        raise SystemExit("Use the MeetingScribe container's Python 3.12.")
    runtime.mkdir(parents=True, exist_ok=True)
    with (runtime / ".meetingscribe-setup.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit("Another runtime installation is in progress.")
        state_path = runtime / ".meetingscribe-setup.json"
        recipe = hashlib.sha256(
            json.dumps(stages(runtime), sort_keys=True).encode()
            + (SOURCE / "runtime/requirements-qwen.txt").read_bytes()
            + (SOURCE / "runtime/requirements-nemotron.txt").read_bytes()
        ).hexdigest()
        if state_path.exists():
            state = json.loads(state_path.read_text())
            if state.get("recipe") != recipe:
                raise SystemExit("Dependency recipe changed. Use a new runtime volume; existing environments are retained.")
        else:
            for name in ("qwen3-asr-env", "nemotron3/.venv", "funasr-compare", "WhisperX"):
                if (runtime / name).exists():
                    raise SystemExit(f"Unmanaged environment exists: {runtime / name}. Use a new runtime directory.")
            state = {"recipe": recipe, "completed": []}

        # Validate all runner destinations before installing anything.
        helper = [sys.executable, str(SOURCE / "scripts/install_runtime_files.py"), "--runtime", str(runtime)]
        run([*helper, "--dry-run"])

        def save():
            pending = state_path.with_suffix(".pending")
            pending.write_text(json.dumps(state, indent=2) + "\n")
            pending.replace(state_path)

        save()
        run(helper)
        for name, command in stages(runtime):
            if name in state["completed"]:
                print(f"Already installed: {name}", flush=True)
                continue
            # uv init can have written pyproject.toml before interruption.
            if name != "WhisperX:init" or not (runtime / "WhisperX/pyproject.toml").is_file():
                run(command)
            state["completed"].append(name)
            save()
        # Download helpers reuse caches and resume partial downloads.
        run([str(runtime / "qwen3-asr-env/bin/python"), str(SOURCE / "scripts/download_models.py"), "--runtime", str(runtime)])
        run([sys.executable, str(SOURCE / "scripts/check_runtime.py"), "--runtime", str(runtime)])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    runtime = args.runtime.resolve()
    if args.dry_run:
        for name, command in stages(runtime):
            print(name + ": " + shlex.join(command))
        print("Then download models and verify files, checkpoint checksum, imports and CUDA.")
        return
    try:
        prepare(runtime)
    except subprocess.CalledProcessError as error:
        raise SystemExit(f"Setup stopped (exit {error.returncode}). Fix the error above and rerun; completed stages and data are retained.")


if __name__ == "__main__":
    main()
