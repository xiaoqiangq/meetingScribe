# Docker deployment

[中文](DEPLOY.md) · [Native installation](INSTALL.en.md) · [Acceptance status](VALIDATION.en.md)

The default Compose file now builds MeetingScribe from this repository. All four existing Compose entry points share the same configuration. Both Dockerfiles build a Linux CUDA application runtime.

**The image does not bundle Qwen/NeMo virtual environments or model weights. Docker image build passed on a clean GitHub Linux runner; fresh GPU model installation and end-to-end acceptance are still pending.** Requirements: a Linux NVIDIA host, running Docker daemon, Compose 2.30+, and NVIDIA Container Toolkit.

## Build

From a fresh checkout:

```bash
mkdir -p data/whisperx-env
export HUIJI_UID="$(id -u)"
export HUIJI_GID="$(id -g)"
docker compose config --quiet
docker compose build
```

The host port defaults to localhost only. Use HTTPS and configure allowed origins and secure cookies for external access.

## Prepare models inside the container

Virtual environments should be created at their container path, not copied from an unrelated host path.

```bash
docker compose run --no-deps --entrypoint /bin/bash huiji-p
export WHISPERX_ENV=/app/whisperx-env
python3 scripts/install_runtime_files.py --runtime "$WHISPERX_ENV"
```

Follow steps 4–7 of [the installation guide](INSTALL.en.md), using the container's Python 3.12 and `/app/whisperx-env` runtime path. Install a CUDA wheel compatible with your driver. Then:

```bash
python3 scripts/check_runtime.py --runtime "$WHISPERX_ENV"
exit
docker compose up -d
docker compose logs --tail 100 huiji-p
curl --fail http://127.0.0.1:8080/health
```

Create the administrator and a model profile, then complete the acceptance checklist. A healthy web endpoint is not proof of model inference.

## Persistent data and upgrades

`HUIJI_DATA_DIR` defaults to `./data`; `HUIJI_RUNTIME_DIR` defaults to `./data/whisperx-env`. These mounts retain the database, recordings, transcripts, enrollment audio, JWT secret and model environments. Back them up separately from code. Stop with `docker compose stop`. See [release and rollback policy](RELEASE.en.md); do not delete production volumes or directories as part of upgrades.
