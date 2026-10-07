# Release policy, upgrades and rollback

[简体中文](RELEASE.md) · [Validation](VALIDATION.en.md) · [Deployment](DEPLOY.en.md) · [Changelog](../CHANGELOG.md)

## Versioning and release gates

The current candidate is `v0.1.0-rc.5`; promote to `v0.1.0` only after fresh GPU acceptance. Versions identify MeetingScribe rather than inheriting the upstream Scriberr version.

- CI must pass on the candidate commit: frontend tests/build, Python bridge tests, selected Go checks, Compose validation and Docker build.
- GPU acceptance must record the commit, environment, model revisions, real short/long recording results and peak resources.
- Minutes acceptance uses an isolated database and a controlled LLM. Production meetings and secrets are excluded from CI.
- Upgrades and rollback must check database migration compatibility; an older binary is not guaranteed to accept a newer database.
- Candidates without complete GPU acceptance must be marked as pre-releases and describe completed checks and remaining gates.

## Candidate packaging

The `.github/workflows/release.yml` workflow runs when `VERSION` changes on `main`. Verification, Compose validation and Docker build must pass before packaging Linux amd64 binaries and SHA256SUMS and creating the version tag and pre-release. Actions artifacts are retained for 30 days. Publication does not deploy production.

Packages contain the application binary, sample configuration, model runtime source, installation helpers and documentation. They exclude model weights, Python environments, recordings and databases. See [current notes](RELEASE-NOTES.md). A version number or tag alone does not establish stability.

## Upgrade procedure

1. Record the running version, commit, model revisions and configuration.
2. Back up a consistent SQLite database together with uploads, transcripts, enrolled voices, JWT secret and configuration. Use a backup API or consistent snapshot for a running SQLite database.
3. Build in a separate code directory and test migration on a separate data copy and port.
4. Stop the old application and switch to the accepted binary/image while preserving persistent-data paths.
5. Check login, account isolation, playback, transcription and minutes history. Retain the previous code and backups; do not delete their directories.

## Rollback

If the database remains compatible, switch back to the previous application. If migration is not backward compatible, restore a **consistent pre-upgrade data copy**, validate it in isolation, then switch the service. Replacing the binary alone is not sufficient in that case. Recursive deletion is not a recovery procedure.


## v0.1.0-rc.2 publishing

The VERSION file triggers the release workflow on main. Tests, Compose validation and Docker build must pass before the workflow creates the pre-release tag and uploads the archive/checksums. See [candidate notes](RELEASE-NOTES.md) and [systemd helpers](../deploy/systemd/README.md).

## v0.1.0-rc.4

The VERSION update on main starts verification and candidate packaging. See [current release notes](RELEASE-NOTES.md). Realtime worker environments remain separate; recursive temporary-directory cleanup tests are excluded under workspace rules. Release artifacts are published only after workflow checks pass.
