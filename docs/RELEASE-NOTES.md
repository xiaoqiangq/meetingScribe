# Huiji P v0.1.0-rc.2 — Website and reliability update

Includes the latest waveform logo and Huiji P branding, English-default interface with instant Chinese switching, Qwen audio-language selection, temporary task recovery, six-hour persisted expiry, unified GPU queuing, resource limits and safer minutes generation / rendering.

Optional systemd templates provide automatic restart, true readiness checks and verified backups excluding temporary recording content. Deployment paths are configurable. The existing GPU1 v18 deployment passed a synthetic English transcription, task recovery, language switching, readiness, restart and database/media backup checks. Physical cleanup runs one tracked file at a time and resumes after downtime; expired content is immediately inaccessible while the service is running.

## Downloads

Use `huiji-p-v0.1.0-rc.2-linux-amd64.tar.gz` and `SHA256SUMS`. Verify with `sha256sum -c SHA256SUMS`, extract into a fresh directory and follow `docs/INSTALL.en.md`. The package includes the application binary, model runtime source, documentation, sample configuration and systemd helpers. Prepare Python/CUDA runtimes and model weights separately. No model weights, recordings, database, voiceprint samples or credentials are included.

## Verification

The publishing workflow verifies Python bridge tests, frontend tests/build, Go regression tests, Compose configuration and Docker build before creating this release and uploading the application archive and checksums. `BUILD-INFO.json` records the exact source commit. Full fresh-GPU installation and upgrade/rollback acceptance remain pending, so this is a **pre-release**.

## 中文

会记P第二个候选版，完整同步网站与 logo、中英文无刷新切换、快速转写恢复及语言选项、六小时过期持久化、统一 GPU 队列、资源限制、纪要完成/失败/部分结果区分、安全 Markdown 表格显示，以及自动重启、真实就绪检查和备份验证模板。

下载 Linux amd64 包和 SHA256SUMS，校验后按安装文档准备模型环境。模型、录音、数据库、私人声纹和密钥不包含在包内。已有 GPU1 部署完成验证，全新 GPU 安装与完整升级回退验收待完成，继续标记预发布。
