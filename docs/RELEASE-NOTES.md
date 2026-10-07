# MeetingScribe v0.1.0-rc.4 — Realtime meeting transcription

Adds a separate realtime microphone option while retaining uploaded-audio processing. The existing Qwen3-ASR-1.7B checkpoint runs through a separate vLLM environment, with continuous Nemotron-3 speaker tracking, FSMN VAD and ForcedAligner. No additional ASR checkpoint is required; vLLM and worker environments must be provisioned separately. See [realtime setup](REALTIME.md) and the sanitized [configuration example](../deploy/realtime.env.example).

Realtime meetings use the existing audio project page: speaker names, transcript editing, playback with seeking, notes and meeting minutes. Audio and confirmed text are saved continuously. Incremental Chunk Manager retains context across short pauses, waits before confirming speaker changes and shares the upload planner's duration limits. Unknown/overlapping voices remain pending. Final recordings can be reprocessed manually using an existing profile, updating the same project's transcript.

This release also unifies MeetingScribe branding, includes the verified GPU source baseline and local font licenses, repairs unknown recording duration and improves profile-dialog layout. Upstream Scriberr attribution is retained.

## Validation and limits

- 58 frontend tests, 20 realtime Python tests and six original Chunk Manager tests passed; TypeScript, frontend and Linux amd64 builds passed.
- Existing GPU deployment is healthy. A 45-second public multi-voice fixture completed with draft text, word timestamps, speaker labels and incremental cuts. This is an inference smoke test, not a speaker-accuracy or microphone latency benchmark.
- One realtime session at a time, up to 30 minutes. Ordinary transcription and realtime inference share admission control. Microphone access requires HTTPS or localhost.
- Saved checkpoints survive interruption; unsent audio and unconfirmed text may be lost. Short/similar/overlapping voices may remain unresolved or be labelled incorrectly.
- Fresh GPU installation, complete upgrade/rollback acceptance and broad browser testing remain pending. This remains a pre-release. The new reprocessing profile selection needs browser acceptance testing.

The workflow publishes the Linux archive and SHA256SUMS only after its verification, Compose and Docker build checks pass. Compatible package filenames retain `huiji-p`. Weights, Python/CUDA environments, recordings, databases, voiceprints, credentials and private validation artifacts are excluded. Publishing does not restart an existing deployment.

## 中文

新增独立的实时麦克风转写入口，复用现有音频项目的角色、文字、播放、笔记和纪要流程。音频与确认文字持续保存；增量分块避免短停顿频繁重置上下文，临时文字行内展示。结束后可按原有配置重新处理完整录音并更新当前项目。

已有 GPU 部署及公开音频流式冒烟测试通过，但不等同于真人会议分人准确率验收。实时环境需独立配置；单次最长 30 分钟，限制一个会话。版本继续标记预发布，安装包不包含模型权重、环境或私人会议资料。
