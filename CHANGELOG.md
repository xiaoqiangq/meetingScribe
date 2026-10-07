# Changelog

[简体中文](CHANGELOG.zh-CN.md)

## v0.1.0-rc.5 — 2026-10-07

- Queue realtime audio inference separately from receipt; run word alignment asynchronously with bounded backlogs and retain confirmed text on alignment failure.
- Keep GPU admission until final processing completes; support legacy finish requests and prevent cleanup from abandoning completed recordings.
- Recover supported word-local speaker labels and keep candidate evidence local to each word, without speaker-triggered ASR cuts.
- Unify upload and realtime reading: carry missing display speaker labels across ASR fragments, hide identity-status badges, and preserve original labels, word indices and timestamps.
- Add client build detection with recording-safe refresh guidance. Validation includes 62 frontend tests, 35 realtime Python tests, six chunk-planner tests, targeted Go race checks, builds and verified GPU deployment. Fresh GPU installation and reference-scored meeting accuracy remain pending; pre-release.

## v0.1.0-rc.4 — 2026-10-07

- Use MeetingScribe consistently in both interface languages; retain upstream attribution and compatible runtime identifiers.
- Add microphone realtime transcription with Qwen3-ASR-1.7B/vLLM, continuous Nemotron-3 speaker labels, VAD and final word alignment.
- Reuse the audio project page for transcript editing, role names, playback, notes and minutes; persist audio and confirmed text continuously.
- Add incremental Chunk Manager, conservative speaker confirmation and readable paragraphs with inline draft text. Offer optional full-recording reprocessing through saved profiles.
- Repair unknown microphone recording duration and profile dialog layout; include the verified GPU source baseline, local fonts and account/upload improvements.
- Validation: 58 frontend tests, 20 realtime Python tests, six original Chunk Manager tests, application builds and a 45-second GPU chunk replay. Fresh GPU installation, reference-scored speaker accuracy and broad browser acceptance remain pending. Pre-release.

## v0.1.0-rc.3 — 2026-10-06

- Correct the header logo to the exact JPG deployed on GPU1 after v18 verification. The prior rc.2 package still used the older PNG.
- Preserve the designer's original image bytes and metadata. The website, README and application package now reference the same JPG.
- 原样同步网站实际使用的新 JPG，保留隐藏设计及原文件元数据；修复 rc.2 漏同步 logo 的问题。

## v0.1.0-rc.2 — 2026-10-06

- Synchronize the GPU1 v18 website, waveform logo and Huiji P branding.
- Switch English / Chinese without reloading; recover temporary tasks and choose their audio language.
- Persist six-hour expiry and exact cleanup paths; deny expired content and resume individual-file cleanup after restart.
- Queue temporary and ordinary transcription together with per-owner admission limits.
- Preserve failed / partial minutes separately; require explicit successful stream completion.
- Disable raw HTML in minutes; render Markdown tables and improve speaker / paragraph readability.
- Add upload size, storage quota, login rate, connection and timeout protections.
- Add readiness / liveness endpoints, optional model provisioning, restart and verified backup templates.
- Existing GPU deployment validated; fresh GPU installation and full upgrade / rollback acceptance remain pending. Pre-release.

## v0.1.0-rc.1

### Added

- English-default interface with a persistent English / Chinese switch; recording content is not translated by the switch.
- Independent Qwen audio-language selection: auto-detection and 11 explicit languages shared with ForcedAligner.
- API, service, adapter and Python language forwarding, language validation, detected-language output and English chunk spacing regressions.


- Chinese and English architecture, model and installation documentation.
- Detailed topic → Nemotron → VAD/chunks → Qwen/aligner → reviewed identities → minutes pipeline.
- Runtime installer, model downloader and environment checks.
- CI for frontend tests/build, selected Go regression tests, Python bridge tests and container build.
- Tag-triggered release-candidate packaging with SHA256 checksums.
- Deployment, acceptance, release and rollback documentation.

### Changed

- English and Chinese README navigation retain five engineering/release entries with matching-language documentation.

- All Compose entry points build Huiji P source instead of pulling upstream Scriberr images.
- Docker application build uses Node 22.12 and Go 1.24.4; model environments remain external.
- Frontend exposes a uniform `npm test` command.

### Validation status

Existing A100 runtime checks pass. Local application tests/build are recorded in docs/VALIDATION.en.md. Fresh GPU installation and container GPU inference acceptance are pending; no stable release is claimed.
