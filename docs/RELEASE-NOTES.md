# Huiji P v0.1.0-rc.3 — Exact website logo correction

Corrects the logo omitted from rc.2: the live GPU1 header uses the later designer-provided JPG, while rc.2 retained the older PNG. The header, README and Linux application package now use the original JPG without conversion, recompression or metadata removal. All rc.2 website/reliability features remain included.

Original image: `web/frontend/src/assets/meeting-assistant-waveform.jpg` (295,610 bytes, 1295 × 1214).
SHA256: `fb08054f1b012bc5798043d08c924c717c80f1d1bb20993d0b8231513a79e2e4` — identical to the image currently served by GPU1.

Download `huiji-p-v0.1.0-rc.3-linux-amd64.tar.gz` and `SHA256SUMS`; verify before extraction and follow `docs/INSTALL.en.md`. Model weights, Python/CUDA environments, user recordings, databases, private voiceprints and credentials are excluded. Publishing does not restart the existing website.

The release workflow verifies Python/frontend/Go tests, the application build, Compose configuration and Docker build before publishing assets. Full fresh-GPU installation and upgrade/rollback acceptance remain pending. This remains a pre-release.

## 中文

修复上一候选版漏同步新 logo 的问题。网站左上角现用 JPG 与本次上传的设计原文件逐字节一致；保留隐藏设计、EXIF 等元数据，不进行格式转换、重新压缩或图片编辑。源码、README 和 Linux 安装包同步改用该 JPG，旧 PNG 保留作历史资产。

本版包含 rc.2 全部网站与可靠性改动，继续标记预发布。下载包提供 SHA256 校验文件，不包含模型权重与私人会议数据。
