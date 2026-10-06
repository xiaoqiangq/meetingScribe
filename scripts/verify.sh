#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/check_source.py
python3 scripts/install_runtime_files.py --runtime /tmp/huiji-dry-run --dry-run
python3 scripts/download_models.py --runtime /tmp/huiji-dry-run --dry-run
PYTHONPATH=runtime/funasr:runtime/nemotron python3 -m unittest discover -s runtime/funasr -p 'test_*.py'
(cd web/frontend && npm test && npm run build)
python3 scripts/copy_frontend.py
go test ./internal/models ./internal/transcription ./internal/queue ./internal/repository ./internal/sse ./internal/llm ./internal/transcription/adapters
# Selected API tests use an in-memory DB and do not remove fixture directories.
go test ./internal/api -run '^(TestMultiuserAccessAndMigration|TestTopicUploadValidation|TestLongRecordingSurvivesProfileSelection|TestBothNvidiaChunkManagerSelectionsSurviveValidation|TestFunASR.*|Test.*Qwen.*Language.*|TestSummaryFailureNeverReplacesCompletedSummary|TestLoginAndUploadLimits)$'
go build -trimpath -o bin/huiji-p ./cmd/server
