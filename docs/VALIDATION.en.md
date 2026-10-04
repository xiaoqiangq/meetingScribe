# Validation status and reproduction record

[简体中文](VALIDATION.md) · [Deployment](DEPLOY.en.md) · [Release policy](RELEASE.en.md)

Recorded on 2026-10-04. This page separates automated checks, existing-deployment checks and fresh installation acceptance.

## Completed checks

- Existing A100 deployment: model paths, Nemotron SHA256, NeMo/Qwen/WhisperX imports and CUDA checks passed.
- Initial local Python checks: 23 bridge, Chunk Manager and diarization-format tests passed without loading model weights.
- Local Compose configuration, Python syntax and Markdown link checks passed.
- Frontend: 20 tests, TypeScript checks and the Vite production build passed.
- Go: topic, routing, clause and selected API ownership/parameter tests passed; the Linux amd64 application cross-build passed.

Local verification used an isolated source directory with existing npm dependencies and Go caches. It was not a fresh dependency installation. GitHub Actions provides the separate clean-runner evidence below.

## Pending acceptance and environment limits

At the recorded check, the local and GPU1 Docker daemons were unavailable. GitHub runners completed image builds; container GPU inference acceptance remains pending. The local workstation is macOS, while the standard inference pipeline requires Linux CUDA. GPU1 continues to run the existing service; checking its existing environment does not establish fresh installation success.

The hosted CI runner has no project GPU and cannot validate model inference. The new container configuration has not passed full production acceptance.

## Fresh GPU acceptance checklist

Use separate directories, a separate database, port and service account. Preserve the existing production deployment.

| Gate | Evidence to record |
| --- | --- |
| Source and environment | Commit/tag, OS, GPU, driver, Docker, full pip freeze and all model revisions |
| Installation | Follow the guide without an old virtual environment; pip check, runtime doctor and installation logs |
| Short recording | Authorized 30–60-second sample; text, word timings, speakers, seeking and export |
| Long recording | At least two topics; independent labels, boundary timings and cross-chunk continuity |
| Identity suggestions | Single-speaker enrollment, names and cross-topic candidates, saved mappings after confirmation and reload |
| Multiple users | Two ordinary accounts cannot access each other's recordings, transcripts or minutes; administrator permissions behave correctly |
| Minutes | Controlled LLM, two templates, sourced/clean views, reopen behavior and history |
| Resources | Cold start and processing time, peak VRAM, disk growth and failure state |
| Upgrade/rollback | Migration on a data copy, compatibility or backup restoration |

This checklist does not claim that these gates have passed. Keep candidate status until the relevant gates are complete.

## Automated test scope

Run `bash scripts/verify.sh` in a fresh checkout. It requires no GPU or meeting samples and covers seven frontend test files, Python bridge tests, Go topic/routing/clause tests and selected API ownership/parameter tests. It does not automatically run every inherited test, real-model accuracy benchmarks, external LLM requests or complete browser workflows.

Temporary test evidence is retained. Directory cleanup is a manual operation; recursive deletion is not part of this workflow.

## First successful GitHub CI

- Commit: `a51344da8f5a32ddfbd446933786f56cfd5f9bb4`.
- [CI #1](https://github.com/xiaoqiangq/huiji-p/actions/runs/37198808281): success.
- A clean Ubuntu runner completed npm ci, 23 Python tests, 20 frontend tests/build, Go regression/API checks and application build, Compose validation, Docker build and application artifact upload.
- GPU inference, external LLM and browser business acceptance were outside that run.

## Language update synchronization

- Source: the retained `language-v17` deployment snapshot, merged with repository installation, CI and release configuration. Generated frontend bundles and private deployment files were excluded.
- Local checks passed: 26 Python tests, 20 frontend tests, TypeScript/Vite build, Go models/transcription and selected API checks, plus Linux amd64 compilation. API checks include language validation and ordinary-user language selection with profile controls preserved.
- The first local Go attempt could not open an HTTP test listener inside the sandbox. The same tests passed with local-listener permission.
- The retained deployment report records a 7.85-second synthetic English sample tested with real Qwen and ForcedAligner under explicit-English and auto-detection settings: both returned `en` with 25 word timestamps. Synchronizing source did not repeat GPU inference or alter the service.
- English-default interface and Chinese switching were browser-checked in that deployment report. Source synchronization did not repeat browser acceptance.
- [CI #3](https://github.com/xiaoqiangq/huiji-p/actions/runs/37203255936), for commit `b2e3c49e0c3a94a49d5f5f491de7b31983037eb4`, passed tests, application build, Compose validation and Docker build.
- These checks do not establish all-language quality, full English-meeting accuracy, live streaming or fresh GPU installation acceptance. Later commits have separate CI status.
