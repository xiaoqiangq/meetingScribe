# Changelog

## Unreleased

### Added

- Chinese and English architecture, model and installation documentation.
- Detailed topic → Nemotron → VAD/chunks → Qwen/aligner → reviewed identities → minutes pipeline.
- Runtime installer, model downloader and environment checks.
- CI for frontend tests/build, selected Go regression tests, Python bridge tests and container build.
- Tag-triggered release-candidate packaging with SHA256 checksums.
- Deployment, acceptance, release and rollback documentation.

### Changed

- All Compose entry points build Huiji P source instead of pulling upstream Scriberr images.
- Docker application build uses Node 22.12 and Go 1.24.4; model environments remain external.
- Frontend exposes a uniform `npm test` command.

### Validation status

Existing A100 runtime checks pass. Local application tests/build are recorded in docs/VALIDATION.md. Fresh GPU installation and Docker image acceptance are pending; no stable release is claimed.
