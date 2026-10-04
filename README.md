# 会记P

自托管语音转写与会议纪要应用，基于 [Scriberr](https://github.com/rishikanthc/Scriberr) 修改。此仓库保存网站、模型运行桥接脚本和安装说明，不包含会议数据、个人声纹或模型权重。

## 当前功能

- 短音频转写；长音频按手动时间点划分 topic。
- Nemotron-3 为每个 topic 独立分人，保留 `topic1/speaker_0` 等标签。
- FSMN-VAD、规则切片、Qwen3-ASR 与 ForcedAligner 生成带字级时间的逐字稿。
- 使用 Nemotron 自身特征推荐姓名及跨 topic 人物联系，用户试听后确认。
- 管理员上传声纹样本；普通用户的数据按账号隔离。
- 会议纪要模板、带来源版/清洁版和历史纪要。
- 网页播放、文字高亮、角色改名及导出。

## 流程

```text
音频 → 短模式直接分人 / 长模式按 topic 串行分人
     → Nemotron 说话人时间区间（恢复全局时间，保留独立标签）
     → 清晰片段的 Nemotron 原生特征 → 姓名/跨 topic 联系候选 → 人工确认

原音频 → FSMN-VAD + Nemotron 区间 → Chunk Manager
       → 连续音频块（padding）→ Qwen3-ASR → ForcedAligner
       → 字级时间 × 说话人区间 → 去重、分句、整句角色归整
       → 网页逐字稿、播放、导出 → 可选会议纪要
```

## 开始使用

见 [构建和运行](docs/INSTALL.md)、[数据与备份](docs/DATA.md)。当前中文模型流程在 Linux NVIDIA GPU 环境部署过；新机器仍需配置相应 Python 环境和下载模型。仓库不是附带模型的一键安装包，也不是 macOS 桌面安装程序。

本地 ASR 不向转写 API 发送音频。会议纪要和对话使用用户配置的 LLM；选择外部服务时会发送相关文本及说话人信息。

## 目录

| 路径 | 用途 |
| --- | --- |
| `cmd/server`、`internal`、`pkg` | Go 服务与账号、转写、纪要逻辑 |
| `web/frontend` | React / TypeScript 网页 |
| `runtime/funasr` | Qwen3-ASR、VAD 和切片脚本 |
| `runtime/nemotron` | Nemotron 分人及原生特征推荐脚本 |
| `docs` | 安装、备份、来源说明 |

## 限制

姓名推荐分数不是身份概率；模型原生特征池化未经过正式声纹验证训练，不能自动确认姓名。每个 topic 的 Nemotron 最多提供八个本地说话人通道，标签仍可能混人或拆人。多用户已有权限隔离和账号管理，尚未实现按用户存储配额及完整 GPU 调度。

## 许可证与来源

保留 Scriberr 的 [MIT 许可证](LICENSE)及原版权声明。见 [来源说明](docs/ATTRIBUTION.md)。模型和第三方依赖按各自许可证使用，不随本仓库分发模型权重。
