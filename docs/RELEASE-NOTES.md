# MeetingScribe v0.1.0-rc.7 — Speaker confirmation and recording reliability

- Unify person/name confirmation for uploaded recordings, realtime recordings and topic views, including manual confirmation, unlinking and consistent name validation. Live updates preserve open dialog edits. Realtime voiceprint name matching is not included.
- Allow 90 minutes of captured realtime audio, excluding pauses, with a final warning and automatic finish/save at the limit.
- Fix transcription retry/title update races, queue failure recovery, cold-start cancellation and GPU admission cleanup; restrict CLI callback destinations and repair multitrack upload/merge handling.
- Store uploads in persistent per-user directories and provide a preview-first migration tool that retains source recordings.
- Redesign the responsive Chinese/English login page; derive browser, mobile and PWA icons from the authoritative JPG logo.

## Validation and limits

- Local validation passed: 55 realtime Python tests, 65 frontend tests, targeted Go API/queue tests, Go race checks for the reliability fixes, TypeScript, frontend and Linux amd64 builds. All Go packages and tests compiled.
- The existing GPU deployment was checked after the application updates. HTTP and HTTPS served identical frontend assets; recorded data and business content were preserved.
- One realtime session at a time, up to 90 minutes of captured audio. Microphone access requires HTTPS or localhost. Model environments and weights must be provisioned separately; see [realtime setup](REALTIME.md).
- Realtime speaker labels and manual name confirmation are available. Automatic voiceprint name candidates for realtime recordings are not implemented.
- A full 90-minute GPU recording, fresh GPU installation, broad browser acceptance and reference-scored speaker accuracy remain pending. This remains a pre-release.

Updating VERSION starts the GitHub Actions candidate workflow. Verification, Compose and Docker checks must pass before it creates the tag and publishes the Linux amd64 archive and SHA256SUMS. Package filenames retain compatible huiji-p identifiers and upstream Scriberr attribution. Weights, Python/CUDA environments, recordings, databases, voiceprints, credentials and private validation artifacts are excluded. Publication does not restart production. User recording paths and migration precautions are documented in [data storage](DATA.md).

## 中文

- 上传录音、实时录音及主题页面统一“人物与姓名确认”，支持手动确认、解除关联和姓名一致性校验；实时更新保留打开弹窗中的修改。实时声纹姓名自动匹配尚未加入。
- 实时录音支持累计采集 90 分钟（暂停不计入），接近上限提示，到达上限自动结束并保存。
- 修复重新转写与标题修改的数据覆盖、队列失败恢复、冷启动取消及 GPU 准入释放；限制 CLI 回调目标，修复多轨上传与合并处理。
- 上传文件按用户固定目录保存，提供默认预览、保留原录音的迁移工具。
- 更新响应式中英文登录页；标签页、手机桌面和 PWA 图标统一由正式 JPG Logo 派生。

已通过本地 55 项实时 Python 测试、65 项前端测试、Go API/队列定向检查、稳定性修复竞态检查及构建。现有 GPU 部署已核查，HTTP 与 HTTPS 前端资源一致，录音及业务数据保留。

实时录音限制为累计采集 90 分钟，暂停不计入；当前仍为单个实时会话。麦克风需要 HTTPS 或 localhost。模型环境和权重需单独准备。尚未完成完整 90 分钟 GPU 连续录音、全新 GPU 安装、多浏览器及参考答案准确率验收，继续预发布。本次发布不重启线上服务。
