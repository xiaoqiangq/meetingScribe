# MeetingScribe v0.1.0-rc.6 — On-demand GPU models and consistent realtime access

Realtime GPU models now load when a session starts. An always-on CPU gateway reports readiness without loading weights, reuses warm model workers, and exits their process group after five idle minutes. Heartbeats preserve active and paused sessions; a disconnected browser is cancelled after the inactivity grace period. Saved checkpoints remain available, but this is not resumable microphone capture.

Cold-start requests have longer timeouts and renew GPU admission while loading. Recording starts after the models are ready. The page shows model state with red, bold guidance for on-demand loading and waiting until Listening before speaking. Uploaded-file transcription keeps its existing per-task loading behavior; it does not share model instances with realtime inference.

The realtime page owns `/live`, including direct navigation, refresh, trailing slash and query parameters. Process liveness is now `/health/live`; update external probes that used the old path. Readiness remains `/health`.

An independent Caddy HTTPS template forwards to the same application as HTTP, without forcing an HTTP redirect. See [HTTPS setup and migration](HTTPS.md). Internal IP certificates still require client trust; proxy deployment alone does not guarantee microphone access on every device. No certificate, private key or production configuration is included.

## Validation and limits

- 51 realtime Python tests, 62 frontend tests and targeted realtime API/queue checks passed locally. TypeScript, frontend and Linux amd64 builds passed.
- Existing GPU deployment was verified, including cold start, warm reuse and idle unload. HTTP, HTTPS and localhost returned the same page and frontend assets after the route and loading-hint changes.
- One realtime session at a time, up to 30 minutes. Microphone access requires HTTPS or localhost. Model environments and weights must be provisioned separately; see [realtime setup](REALTIME.md).
- Fresh GPU installation, long-meeting performance, broad browser acceptance and reference-scored speaker accuracy remain pending. This is a pre-release.

Updating VERSION starts the GitHub Actions candidate workflow. Verification, Compose and Docker checks must pass before the workflow creates the tag and publishes the Linux amd64 archive and SHA256SUMS. Package filenames retain compatible huiji-p identifiers and upstream Scriberr attribution. Weights, Python/CUDA environments, recordings, databases, voiceprints, credentials and private validation artifacts are excluded. Publication does not restart production.

## 中文

实时模型改为开始时按需加载，结束后空闲五分钟释放显存；短时间重启可复用模型。CPU 网关状态查询不加载权重，录音与有心跳的暂停保持模型可用。冷启动期间延长请求等待并续期 GPU 准入，模型准备完成后才开始采集；页面以红色加粗显示加载提示。

HTTP、HTTPS 和 localhost 使用同一应用。`/live` 返回实时页面，存活检查迁至 `/health/live`；现有 `/health` 就绪检查保留。独立 HTTPS 模板不会强制跳转 HTTP，内网 IP 证书仍需设备信任。上传音频仍按任务加载模型，与实时实例不共用。

已有 GPU 部署、冷启动/复用/卸载、三个入口资源一致性及本地测试通过。全新 GPU 安装、长会议、多浏览器与参考答案准确率验收仍待完成，继续预发布。本次发布不更改线上运行状态。
