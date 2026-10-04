# Release policy, upgrades and rollback

[简体中文](RELEASE.md) · [Validation](VALIDATION.en.md) · [Deployment](DEPLOY.en.md) · [Changelog](../CHANGELOG.md)

## Versioning and release gates

The code remains under `Unreleased` in the changelog. The first candidate version is `v0.1.0-rc.1`; promote to `v0.1.0` only after fresh GPU acceptance. Versions identify Huiji P, rather than inheriting Scriberr's upstream version.

- CI must pass on the candidate commit: frontend tests/build, Python bridge tests, selected Go checks, Compose validation and Docker build.
- GPU acceptance must record the commit, environment, model revisions, real short/long recording results and peak resources.
- Minutes acceptance uses an isolated database and a controlled LLM. Production meetings and secrets are excluded from CI.
- Upgrades and rollback must check database migration compatibility; an older binary is not guaranteed to accept a newer database.
- Candidates without complete GPU acceptance must be marked as pre-releases and describe completed checks and remaining gates.

## Candidate packaging

The `.github/workflows/release.yml` workflow responds to `v*` tag pushes, reruns verification and creates a Linux amd64 package plus SHA256SUMS. Actions artifacts are retained for 30 days. The workflow has read-only repository permissions and does not publish a Release or deploy production automatically.

Packages contain the application binary, sample configuration, model runtime source, installation helpers and documentation. They exclude model weights, Python environments, recordings and databases. After review, attach the unchanged artifact and checksums to a GitHub Release with its tag and notes. Any separately built package must state its source commit and build origin.

Confirm CI on the intended commit before tagging. A version number alone does not establish stability.

## Upgrade procedure

1. Record the running version, commit, model revisions and configuration.
2. Back up a consistent SQLite database together with uploads, transcripts, enrolled voices, JWT secret and configuration. Use a backup API or consistent snapshot for a running SQLite database.
3. Build in a separate code directory and test migration on a separate data copy and port.
4. Stop the old application and switch to the accepted binary/image while preserving persistent-data paths.
5. Check login, account isolation, playback, transcription and minutes history. Retain the previous code and backups; do not delete their directories.

## Rollback

If the database remains compatible, switch back to the previous application. If migration is not backward compatible, restore a **consistent pre-upgrade data copy**, validate it in isolation, then switch the service. Replacing the binary alone is not sufficient in that case. Recursive deletion is not a recovery procedure.
