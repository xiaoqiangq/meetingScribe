# 发布、升级与回退

[English](RELEASE.en.md) · [验收记录](VALIDATION.md) · [部署](DEPLOY.md) · [更新日志](../CHANGELOG.zh-CN.md)

## 版本与发布门槛

当前候选为 `v0.1.0-rc.5`；完成全新 GPU 环境验收后才发布 `v0.1.0`。版本号描述 MeetingScribe，不沿用 Scriberr 的原版版本号。

- CI 必须在待发布提交上通过：前端测试/构建、Python 桥接测试、所选 Go 回归测试、Compose 配置和 Docker 构建。
- GPU 验收报告必须记录提交、环境、模型 revision、真实短/长音频结果及峰值资源。
- 纪要验收需使用隔离数据库与受控 LLM；不得把生产会议或密钥带入 CI。
- 升级/回退要检查数据库迁移；新二进制不保证旧数据库可以直接回退。
- 候选缺少 GPU 验收时必须标为 prerelease，说明已验证范围及未通过的门槛。

## 自动候选打包

`.github/workflows/release.yml` 在 `main` 的 `VERSION` 更新时运行验证、Compose 校验与 Docker 构建，通过后生成 Linux amd64 包、SHA256SUMS、版本标签与预发布 Release。Actions artifact 保留 30 天；发布不自动部署线上。

安装包包含网站二进制、示例配置、模型运行源码、安装助手与文档，不包含模型权重、Python 环境、录音或数据库。当前说明见 [发布说明](RELEASE-NOTES.md)。版本号与标签不代表已经达到稳定版验收门槛。

## 升级

1. 记录正在运行的MeetingScribe版本、commit、模型 revision 及配置。
2. 备份一致性 SQLite、uploads、transcripts、声纹库、JWT secret 和配置；运行中的 SQLite 使用备份接口或一致性快照。
3. 在新代码目录构建，在独立数据副本和独立端口完成验收；先验证数据迁移。
4. 停止旧应用，切换到已验收的二进制或镜像，保持持久化目录路径。
5. 检查登录、用户隔离、播放、转写、纪要历史；保留旧代码和备份，不删除旧目录。

## 回退

若只变更应用且数据库兼容，可切回旧应用。若迁移不向后兼容，需恢复升级前的**一致性数据副本**并在隔离目录验证，再切换服务。回退不能靠把旧二进制硬套到新数据库。不要用递归删除恢复环境。


## v0.1.0-rc.2 publishing

The VERSION file triggers the release workflow on main. Tests, Compose validation and Docker build must pass before the workflow creates the pre-release tag and uploads the archive/checksums. See [candidate notes](RELEASE-NOTES.md) and [systemd helpers](../deploy/systemd/README.md).

## v0.1.0-rc.4

The VERSION update on main starts verification and candidate packaging. See [current release notes](RELEASE-NOTES.md). Realtime worker environments remain separate; recursive temporary-directory cleanup tests are excluded under workspace rules. Release artifacts are published only after workflow checks pass.
