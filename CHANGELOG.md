# Changelog

[简体中文](CHANGELOG.zh-CN.md)

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
