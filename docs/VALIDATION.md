# 验收状态与复现记录

[English](VALIDATION.en.md) · [部署](DEPLOY.md) · [发布策略](RELEASE.md)

记录日期：2026-10-04。此页区分自动测试、现有部署检查与从零安装。

## 已完成

- 现有 A100 部署：模型文件路径、Nemotron SHA256、NeMo/Qwen/WhisperX 导入与 CUDA 检查通过。
- Python：23 项桥接/Chunk Manager/分人格式回归测试通过，不加载权重。
- Compose：本机 `docker compose config --quiet` 通过。
- Python 语法及本地 Markdown 链接检查通过。

- 前端：20 项测试通过，TypeScript + Vite 生产构建通过。
- Go：topic/路由/分句逻辑及选定 API 多用户/参数验证测试通过，Linux amd64 应用交叉构建通过。

本次使用独立源码目录，前端复用已安装 npm 依赖，Go 复用编译缓存，因此不属于依赖从零安装。CI 最终结果以 GitHub Actions 记录为准。

## 尚未完成及当前阻碍

本机和 GPU1 的 Docker daemon 都不可连接；镜像构建已转由 GitHub runner 完成，但容器 GPU 推理验收尚未完成。本机是 macOS，标准模型流程要求 Linux CUDA；GPU1 继续运行现有服务，不能将现有环境检查当作全新安装结果。

CI 已在 GitHub 托管 Linux runner 上通过镜像构建，但它没有本项目的 GPU，不能验收模型推理。新部署配置不被标为已经验收的生产镜像。

## 从零 GPU 验收清单

使用独立目录、独立数据库、独立端口与服务账号；已有生产环境不得覆盖。

| 门槛 | 需要记录的证据 |
| --- | --- |
| 来源 | commit/tag、系统、GPU、驱动、Docker、完整 pip freeze、全部模型 revision |
| 安装 | 无复用旧 venv，从文档开始；pip check、runtime doctor 与安装日志 |
| 短音频 | 30–60 秒获授权音频；文字、字词时间、分人、试听跳转和导出 |
| 长音频 | 至少两个 topic；独立标签、边界时间、跨 chunk 文本连续性 |
| 人物推荐 | 单人登记、姓名候选、跨 topic 联系、确认后映射保存与刷新 |
| 多用户 | 两个普通账号互相不能访问录音/逐字稿/纪要；管理员功能权限正确 |
| 纪要 | 受控 LLM、两个模板、来源版/清洁版、关闭重开及历史保留 |
| 资源 | 冷启动与处理耗时、显存峰值、磁盘增量、失败后状态 |
| 升级/回退 | 数据副本上的迁移、旧版兼容性或备份恢复验证 |

这份清单不是上述项目已经通过的声明。未达到门槛时保留候选状态。

## 测试范围

`bash scripts/verify.sh` 在新 checkout 运行，不需要 GPU 或会议样本。它覆盖前端 7 个测试文件、Python 桥接测试、Go topic/路由/分句逻辑及选定的 API 多用户/参数验证测试。没有自动运行所有继承测试、真实模型精度评测、外部 LLM 或整套浏览器流程。

测试产生的临时证据保留；本次没有执行递归目录清理。需要清理目录时由用户手动处理。

## 首次 GitHub CI 通过记录

- 提交：`a51344da8f5a32ddfbd446933786f56cfd5f9bb4`。
- [CI #1](https://github.com/xiaoqiangq/meetingScribe/actions/runs/37198808281)：success。
- 干净 Ubuntu runner 完成 npm ci、Python 23 项测试、前端 20 项测试与生产构建、Go 回归/API 测试与应用构建、Compose 配置检查、Docker 镜像构建和应用 artifact 上传。
- 没有 GPU 推理、外部 LLM 或浏览器业务验收；不要扩大通过范围。

## 语言更新同步（2026-10-04）

- 来源：保留的 `language-v17` 部署源码快照，与仓库的安装、CI和发布配置合并；未同步前端构建产物或私有部署文件。
- 本地验证通过：26项Python测试、20项前端测试、TypeScript/Vite构建、Go模型/转写及所选API测试、Linux amd64编译。API测试包含语言验证及普通用户语言选择，同时保留Profile的模型/设备限制。
- 首次Go测试因沙箱无法打开本地HTTP监听而中断；取得本地监听权限后，相同测试通过。
- 既有部署记录包含7.85秒合成英文样本的真实Qwen与ForcedAligner测试：显式英文和自动检测均返回 `en`，生成25个词时间戳。源码同步没有重跑GPU推理，也没有修改线上服务。
- 英文默认界面与中文切换已在既有部署记录中通过浏览器检查；源码同步没有重复网页验收。
- 提交 `b2e3c49e0c3a94a49d5f5f491de7b31983037eb4` 的 [CI #3](https://github.com/xiaoqiangq/meetingScribe/actions/runs/37203255936) 已通过测试、应用编译、Compose验证和Docker构建。
- 这些检查不代表全部语言效果、完整英文会议、实时流式或全新GPU安装已通过验收。后续提交的CI状态需独立核查。
