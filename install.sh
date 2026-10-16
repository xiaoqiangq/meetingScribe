#!/usr/bin/env bash
# MeetingScribe quick installation for a fresh Linux NVIDIA host.
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

case "${1:-}" in
  --dry-run)
    echo 'Check Linux, NVIDIA driver, Docker and Compose >= 2.30'
    echo 'Build MeetingScribe in Docker (no host Go, Node or Python needed)'
    echo 'Check container GPU access, install isolated model environments, download weights'
    echo 'Verify model imports/CUDA/checksum, start web service, wait for health'
    echo 'Use project meetingscribe-quickstart with persistent Docker volumes'
    exit 0 ;;
  --help|-h)
    echo 'Usage: bash install.sh [--dry-run]'
    echo 'Requires Linux x86_64, NVIDIA driver, Docker Compose >= 2.30 and NVIDIA Container Toolkit.'
    exit 0 ;;
  '') ;;
  *) echo "Unknown option: $1" >&2; exit 2 ;;
esac

fail() { echo "MeetingScribe: $*" >&2; exit 1; }
trap 'echo "Installation stopped. Fix the error above and rerun: bash install.sh. Downloaded data is retained." >&2' ERR
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || fail 'Quick installation requires Linux x86_64 with an NVIDIA GPU.'
command -v nvidia-smi >/dev/null || fail 'Install the NVIDIA driver first (nvidia-smi is missing).'
nvidia-smi >/dev/null
command -v docker >/dev/null || fail 'Install Docker Engine and the Docker Compose plugin first.'
docker info >/dev/null
compose_version=$(docker compose version --short)
compose_version=${compose_version#v}
IFS=. read -r compose_major compose_minor _ <<< "$compose_version"
[[ "$compose_major" =~ ^[0-9]+$ && "$compose_minor" =~ ^[0-9]+$ ]] || fail "Cannot read Compose version: $compose_version"
(( compose_major > 2 || (compose_major == 2 && compose_minor >= 30) )) || fail 'Docker Compose 2.30 or newer is required.'

# Do not import an existing native deployment's .env into this isolated project.
compose=(docker compose --env-file /dev/null --project-name meetingscribe-quickstart --file docker-compose.quickstart.yml)
"${compose[@]}" config --quiet
running=$("${compose[@]}" ps --status running --quiet)
[[ -z "$running" ]] || fail 'Quickstart is already running. This installer does not modify a running installation; see docs/DEPLOY.md.'

echo '[1/4] Building MeetingScribe'
"${compose[@]}" build
echo '[2/4] Checking container GPU access'
"${compose[@]}" run --rm --no-deps --entrypoint nvidia-smi huiji-p
echo '[3/4] Preparing models (first run downloads large dependencies and weights)'
"${compose[@]}" run --rm --no-deps --entrypoint python3 huiji-p /app/scripts/setup_runtime.py --runtime /app/whisperx-env
echo '[4/4] Starting MeetingScribe'
"${compose[@]}" up -d
for ((attempt=0; attempt<60; attempt++)); do
  if "${compose[@]}" exec -T huiji-p python3 -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8080/health", timeout=3).close()' >/dev/null 2>&1; then
    echo "MeetingScribe is running: http://localhost:${HUIJI_PORT:-8080}"
    echo 'Create the administrator account, then follow the first-use steps in docs/INSTALL.md.'
    echo 'Realtime microphone transcription requires the additional service in docs/REALTIME.md.'
    exit 0
  fi
  sleep 2
done
"${compose[@]}" logs --tail 80 huiji-p
fail 'Web startup did not pass health checks. Data is retained; inspect the logs above.'
