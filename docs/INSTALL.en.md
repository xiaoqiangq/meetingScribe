# Installation and operation

[简体中文](INSTALL.md) · [Home](../README.en.md) · [Models](MODELS.en.md)

## Scope

Reference target: Ubuntu 24.04, NVIDIA CUDA GPU and Python 3.12. The deployed A100 environment and source build have been checked. A complete fresh-host installation with new downloads has not been independently accepted. Use new runtime directories rather than modifying an existing working environment.

Plan for a 16 GB or larger GPU, 32 GB RAM and at least 60 GB disk plus recording storage; these are planning suggestions, not measured minimum requirements. Use Go compatible with go.mod (1.24.4 toolchain), Node.js 22.12+ with npm and uv. macOS/Windows CPU-only operation of the complete standard pipeline is not claimed.

## 1. System tools and repository

```bash
sudo apt-get update
sudo apt-get install -y git ffmpeg libsndfile1 build-essential python3.12 python3.12-venv python3-dev
git clone https://github.com/xiaoqiangq/huiji-p.git
cd huiji-p
```

Install Go, Node.js and uv from their official sources. Authenticate your command-line Git for this private repository; browser or connector login does not automatically provide Git credentials.

```bash
go version
node --version
uv --version
ffmpeg -version
nvidia-smi
```

## 2. Build the application

```bash
cd web/frontend
npm ci
npm run build
cd ../..
python3 scripts/copy_frontend.py
go build -o bin/huiji-p ./cmd/server
```

Expected outputs: bin/huiji-p and internal/web/dist/index.html. The copy helper refuses a nonempty destination; use a fresh checkout for a repeated build. This does not install models.

## 3. Install runtime files

Run from the repository root:

```bash
export WHISPERX_ENV="$(pwd)/data/whisperx-env"
mkdir -p "$WHISPERX_ENV"
python3 scripts/install_runtime_files.py --runtime "$WHISPERX_ENV" --dry-run
python3 scripts/install_runtime_files.py --runtime "$WHISPERX_ENV"
```

The helper installs seven source files and refuses to overwrite different existing versions. Container paths must refer to mounted directories inside the container.

## 4. Isolated Qwen environment

```bash
python3.12 -m venv "$WHISPERX_ENV/qwen3-asr-env"
"$WHISPERX_ENV/qwen3-asr-env/bin/python" -m pip install --upgrade pip
```

Choose a CUDA-compatible PyTorch build using the [official selector](https://pytorch.org/get-started/locally/). Example for a compatible CUDA 12.6 system:

```bash
"$WHISPERX_ENV/qwen3-asr-env/bin/python" -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu126
"$WHISPERX_ENV/qwen3-asr-env/bin/python" -m pip install -r runtime/requirements-qwen.txt
"$WHISPERX_ENV/qwen3-asr-env/bin/python" -m pip check
"$WHISPERX_ENV/qwen3-asr-env/bin/python" -c "import torch,funasr,transformers; print(torch.__version__,torch.version.cuda,torch.cuda.is_available()); print(funasr.__version__,transformers.__version__)"
```

CUDA must report True. Integration pins FunASR 1.4.16 and Transformers 4.57.6. The bridge adapts timestamp units for this FunASR version; review before upgrades. The example wheel choice is not a clean-host end-to-end validation.

## 5. Isolated Nemotron environment

```bash
python3.12 -m venv "$WHISPERX_ENV/nemotron3/.venv"
"$WHISPERX_ENV/nemotron3/.venv/bin/python" -m pip install --upgrade pip setuptools wheel Cython packaging
"$WHISPERX_ENV/nemotron3/.venv/bin/python" -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu126
"$WHISPERX_ENV/nemotron3/.venv/bin/python" -m pip install -r runtime/requirements-nemotron.txt
"$WHISPERX_ENV/nemotron3/.venv/bin/python" -m pip check
"$WHISPERX_ENV/nemotron3/.venv/bin/python" -c "import torch; from nemo.collections.asr.models import SortformerEncLabelModel; print(torch.__version__,torch.cuda.is_available())"
```

The requirements file pins the NVIDIA-NeMo/Speech source commit required by this checkpoint. An arbitrary PyPI wheel with the same displayed version can differ. Existing deployment shares common packages through a .pth file; do not copy a .pth pointing to another machine. Install complete dependencies on a new host.

## 6. Legacy compatibility checks used by the current Go adapter

Even Qwen jobs pass the current FunASR adapter's legacy readiness checks:

```bash
uv init --bare --python 3.12 "$WHISPERX_ENV/WhisperX"
uv add --project "$WHISPERX_ENV/WhisperX" 'whisperx==3.8.7rc1'
uv run --native-tls --project "$WHISPERX_ENV/WhisperX" python -c "import whisperx; print('WhisperX ready')"
python3.12 -m venv "$WHISPERX_ENV/funasr-compare"
"$WHISPERX_ENV/funasr-compare/bin/python" -m pip install 'funasr==1.4.16' kaldi-native-fbank
```

Use these commands only for new directories; retain existing working environments. This check does not change a Qwen job into Whisper recognition. Other inherited adapters may also initialize; optional Canary, Parakeet and PyAnnote failures should be assessed separately from the required Qwen/Nemotron status.

## 7. Download weights and verify readiness

```bash
python3 scripts/download_models.py --runtime "$WHISPERX_ENV" --dry-run
"$WHISPERX_ENV/qwen3-asr-env/bin/python" scripts/download_models.py --runtime "$WHISPERX_ENV"
python3 scripts/check_runtime.py --runtime "$WHISPERX_ENV"
```

Downloads: Qwen ASR and aligner via Hugging Face, FSMN-VAD and CAM++ via ModelScope, and the pinned Nemotron .nemo checkpoint via Hugging Face. Expected checksum:

```text
867c53f552998f772e5b5e5c082962ae85ee7ca5669c2bc17d7f615133d4e96d
```

Qwen/VAD use current snapshots; record downloaded revisions if reproducibility is required. This helper is not a complete content-addressed lock. Offline hosts need complete model directories prepared elsewhere. Alternative Qwen downloads are described by [Qwen's official repository](https://github.com/QwenLM/Qwen3-ASR#download).

See the full directory tree in [the Chinese guide](INSTALL.md#7-下载模型并检查路径). check_runtime.py verifies paths, checkpoint checksum, imports and CUDA; it does not run recognition or prove timestamp accuracy.

## 8. Configure and start

```bash
cp .env.example .env
```

Set WHISPERX_ENV to the absolute path selected above. Keep DATABASE_PATH, UPLOAD_DIR, TRANSCRIPTS_DIR and TOPIC_NATIVE_REFERENCE_ROOT under persistent data storage. Local defaults bind 127.0.0.1:8080. Preserve the generated data/jwt_secret with your backups.

```bash
./bin/huiji-p
```

In another terminal:

```bash
curl --fail http://127.0.0.1:8080/health
```

Open http://127.0.0.1:8080. A healthy web response does not mean all models are ready. Check model status, logs and an actual short recording. For external access, configure the binding/origins, HTTPS reverse proxy and SECURE_COOKIES=true. Use your own systemd/container supervisor for production. Inherited upstream Docker Compose files do not provision this complete Chinese model stack.

## 9. First-run acceptance

1. Create the first administrator on an empty database. Later accounts are administrator-managed.
2. Create a Transcription Profile: FunASR family, Qwen3-ASR-1.7B, CUDA, Nemotron and Chunk Manager. If no profiles exist, use advanced transcription first.
3. Process an authorized 30–60 second sample; check text, timestamps and playback seeking.
4. Enroll a clean single-speaker sample in the administrator voiceprint library. Accepted duration: 10–180 seconds; suggested duration: 20–60 seconds.
5. Test one manual long-audio topic boundary and inspect topic-local labels; confirm proposed identities by listening.
6. Configure your local/external LLM and minutes templates, then check sourced/clean views and history.

## 10. Standalone local scripts

```bash
mkdir -p local-result-001
ffmpeg -nostdin -i your-meeting.wav -ac 1 -ar 16000 local-result-001/input.wav
"$WHISPERX_ENV/nemotron3/.venv/bin/python" "$WHISPERX_ENV/nemotron3/nemotron3_diarize.py" local-result-001/input.wav local-result-001/diarization.json --device cuda
"$WHISPERX_ENV/qwen3-asr-env/bin/python" "$WHISPERX_ENV/funasr-runtime/qwen3_transcribe.py" local-result-001/input.wav local-result-001/transcript.json --chunk-manager-sortformer local-result-001/diarization.json
```

These produce model JSON, chunk plans and alignment evidence. They do not perform the full web sentence-role assignment, topic confirmation or minutes workflow.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Private clone fails | Authenticate command-line Git |
| CUDA unavailable | Driver, wheel channel, GPU mapping |
| RoPE / strict load errors | Exact NeMo source commit and checkpoint checksum |
| Missing Qwen model | Complete model/config/tokenizer directory |
| Missing VAD config | Fixed ModelScope snapshots/master location |
| FunASR not ready despite Qwen | Step 6 compatibility directories |
| Missing name suggestions | Enrollment, sample-plan, helper files, logs |
| Empty profile menu | Administrator-created profiles / advanced mode |
| Incorrect timestamps | FunASR version, seconds vs milliseconds, double offsets |
| Out of memory | Reduce batch/concurrency; disk weights are not VRAM estimates |
| Minutes fail | LLM endpoint, credentials, model name and context limit |

The helper scripts are syntax/dry-run checked and the existing A100 runtime is inspected without restarting the service. Fresh-host downloads and end-to-end operation remain subject to the acceptance steps above.

## Containers and release management

[Huiji P Docker entry](DEPLOY.en.md) · [Acceptance status](VALIDATION.md) · [Releases and rollback](RELEASE.md)
