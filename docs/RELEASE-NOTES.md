# MeetingScribe v0.1.0-rc.5 — Realtime processing and readable transcripts

Realtime PCM receipt now acknowledges ordered audio without waiting for model inference. Word alignment runs independently with bounded queues; confirmed text is retained when alignment is unavailable. Speaker changes no longer reset ASR context. Finishing drains inference and alignment before releasing GPU admission, including compatibility with older pages.

Word-local speaker evidence can recover strong words in short runs of an established voice. Candidates are restricted to the word's own time interval. These changes do not establish reference-scored diarization accuracy.

Upload and realtime transcripts share the same reading presentation. Missing speaker labels follow the preceding display voice across ASR fragment boundaries; explicit labels take precedence and a leading unknown stays unnamed. Identity-status badges are hidden. Original labels, timestamps and word indices remain intact, so display attribution is not a model confirmation. Unrecognized speaker changes can be displayed under the preceding voice.

Pages detect a new build and ask users to finish recording and download a backup before refreshing. Completed recordings hide leftover draft text. This release does not add resumable microphone sessions after closing a page; already saved checkpoints are retained, but unsent audio can be lost.

## Validation and limits

- 62 frontend tests, 35 realtime Python tests, six original Chunk Manager tests and realtime API/queue race checks passed locally. TypeScript, frontend and Linux amd64 builds passed.
- Existing GPU deployment is healthy. Program, frontend assets and launchers were verified; model and offline runtime checksums were retained. Browser checks confirmed unique word indices, unchanged timestamps and identical upload/realtime presentation for the same data.
- One realtime session at a time, up to 30 minutes. Microphone access requires HTTPS or localhost. Qwen/vLLM, Nemotron and alignment workers require separately provisioned environments; see [setup](REALTIME.md).
- Fresh GPU installation, complete upgrade/rollback acceptance, long-meeting performance and reference-scored speaker accuracy remain pending. This is a pre-release.

The workflow creates the version tag and publishes the Linux amd64 archive with SHA256SUMS only after verification, Compose and Docker checks pass. Package filenames retain compatible huiji-p identifiers and upstream Scriberr attribution. Weights, Python/CUDA environments, recordings, databases, voiceprints, credentials and private validation artifacts are excluded. Publication does not restart production.

## 中文

本次修复实时转写接收阻塞、慢对齐及结束兼容问题，改进字词局部说话人判定。上传与实时正文共用展示规则，没有说话人的内容跨片段沿用前一位显示归属，保留明确换人、原始标签和时间戳；不显示身份待确认等提示。显示沿用不代表模型确认，未识别的换人仍可能归到前一位。

已有 GPU 部署、本地测试与浏览器字词完整性检查通过。全新 GPU 安装、长会议性能与参考答案准确率仍待验收，版本保持预发布。关闭网页会停止录音，服务器保留已保存部分，未上传尾音可能丢失；本版没有跨页面恢复录音会话功能。
