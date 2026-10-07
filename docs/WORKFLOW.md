# Development workflow / 开发工作流

MeetingScribe is the display name in all interface languages. The current
remote repository is `xiaoqiangq/meetingScribe`. Local directory names and remote
repository names need not match.

## Directory boundaries

- Source, tests, documentation, licenses and sanitized configuration examples are versioned.
- `.local/notes`, `.local/experiments`, `.local/screenshots`, `.local/recordings`,
  `.local/baseline` and `.local/validation` contain local-only material.
- `.local/` is excluded from Git and Docker contexts; it requires separate backup.
- Actual credentials, databases, recordings, voiceprints and models are not versioned.
- Keep existing runtime identifiers for compatibility; renaming the brand does
  not require renaming the Go module, data paths or browser preference keys.

## Development and publishing

1. Work in a branch of this repository; preserve the shared Git history.
2. Record shareable decisions in `docs/`, private notes in `.local/notes/`.
3. Run checks appropriate to the changes. Inspect deletion behavior before
   invoking legacy test/build scripts under the project's no-directory-deletion rule.
4. Stage explicitly named paths, run `python3 scripts/check_publish_paths.py --staged`,
   then inspect the staged diff. Ignored files already tracked remain tracked.
5. Push only when authorized. Direct GitHub API writes require the same path/content review.
6. Deploy an identified commit only when authorized, record checksums and rollback
   instructions, and verify the application on the actual client.

The path checker is an extra guard, not a secret scanner or a replacement for diff
review. Do not automatically run broad cleanup or force-add ignored files.

The local checkout uses `.githooks/pre-commit` to run the path guard before a Git
commit. After cloning elsewhere, enable it with `git config core.hooksPath .githooks`.
Hooks can be bypassed and do not guard direct API uploads; review remains required.
