# Install MeetingScribe

[简体中文](INSTALL.md) · [Home](../README.md)

Use the automatic installer. You do not need Go, Node.js or Python on the host, or manual commands for each model environment.

## Prepare a GPU machine

Requirements: **Linux x86_64, an NVIDIA GPU and working driver, Docker Engine, Docker Compose 2.30+, and NVIDIA Container Toolkit**. `nvidia-smi` must show the GPU, and your account must be able to run `docker info`.

Plan for 16 GB or more VRAM, 32 GB RAM, and at least 60 GB disk plus recordings. These are planning suggestions, not measured minimums. First installation downloads large dependencies and weights from GitHub, PyPI, Hugging Face, ModelScope and PyTorch; allow the terminal progress to finish.

## Install and start

```bash
git clone https://github.com/xiaoqiangq/meetingScribe.git
cd meetingScribe
bash install.sh
```

Authenticate command-line Git first if the repository is private.

The installer builds the application, checks container GPU access, prepares isolated model environments, downloads weights, checks CUDA and model files, and starts the web service. If a step fails, fix the reported error and rerun `bash install.sh`; completed dependency stages and download caches are retained.

Open **http://localhost:8080** after installation. For a remote server, run this on your own computer first:

```bash
ssh -L 8080:127.0.0.1:8080 your-user@your-server
```

Then open http://localhost:8080 on your computer.

## First use

1. Create the administrator account in the browser.
2. Save a transcription profile with **FunASR → Qwen3-ASR-1.7B, CUDA, Nemotron and Chunk Manager**, or use advanced transcription first.
3. Upload a 30–60 second recording and check text, speakers and playback seeking.
4. For meeting minutes, configure your own local or external LLM in settings.

Automatic setup covers uploaded recordings, diarization, alignment and voiceprint helpers. Realtime microphone transcription needs the separate vLLM environment and service described in [Realtime setup](REALTIME.md).

## Stop, start and troubleshoot

```bash
# View logs
docker compose --env-file /dev/null -p meetingscribe-quickstart -f docker-compose.quickstart.yml logs --tail 100 huiji-p

# Stop, retaining recordings, database, models and environments
docker compose --env-file /dev/null -p meetingscribe-quickstart -f docker-compose.quickstart.yml stop

# Start again without reinstalling
docker compose --env-file /dev/null -p meetingscribe-quickstart -f docker-compose.quickstart.yml up -d
```

Data is stored in persistent Docker volumes `meetingscribe-quickstart_data` and `meetingscribe-quickstart_runtime`; back them up before upgrades. The installer uses a separate project, does not read an existing deployment's `.env`, and does not migrate existing data. For existing installations, follow [Deployment and upgrades](DEPLOY.en.md).

| Error | Action |
| --- | --- |
| Docker or NVIDIA driver missing | Complete the host prerequisites above |
| GPU unavailable inside container | Check NVIDIA Container Toolkit and CUDA 12.6 driver compatibility |
| Download failed | Restore access to the download service, then rerun |
| Port 8080 in use | Run `HUIJI_PORT=8081 ALLOWED_ORIGINS=http://localhost:8081 bash install.sh`; use the same variables for subsequent management commands |
| Service already running | The installer refuses to modify a running installation; inspect logs and use the upgrade guide |

For source development, custom CUDA or manual troubleshooting, see [Advanced native installation](INSTALL.native.en.md). See [Deployment](DEPLOY.en.md) for HTTPS, external access and backups.

Validation boundary: automated installation checks do not perform recording inference. A complete fresh Linux GPU installation, including downloads and transcription, still needs independent acceptance. The current development machine cannot perform that GPU validation.
