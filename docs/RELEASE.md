# 发布、升级与回退

[验收记录](VALIDATION.md) · [部署](DEPLOY.md) · [更新日志](../CHANGELOG.md)

## 版本与发布门槛

当前为 `Unreleased`。首次候选建议使用 `v0.1.0-rc.1`；完成全新 GPU 环境验收后才发布 `v0.1.0`。版本号描述会记P，不沿用 Scriberr 的原版版本号。

- CI 必须在待发布提交上通过：前端测试/构建、Python 桥接测试、所选 Go 回归测试、Compose 配置和 Docker 构建。
- GPU 验收报告必须记录提交、环境、模型 revision、真实短/长音频结果及峰值资源。
- 纪要验收需使用隔离数据库与受控 LLM；不得把生产会议或密钥带入 CI。
- 升级/回退要检查数据库迁移；新二进制不保证旧数据库可以直接回退。
- 候选缺少 GPU 验收时必须标为 prerelease，说明已验证范围及未通过的门槛。

## 自动候选打包

`.github/workflows/release.yml` 在 `v*` tag 推送时重新运行验证并生成 Linux amd64 包和 SHA256SUMS，作为 Actions artifact 保存 30 天。该 workflow 只读仓库，不自动创建 Release、不部署线上。

安装包包含网站二进制、示例配置、模型运行源码、安装助手与文档；不包含模型权重、Python 环境、录音或数据库。管理员审核 artifact 和 GPU 验收后，将原样 artifact 与校验清单附到 GitHub Release，保留对应 tag 和发布说明。

创建 tag 前应先确认 `main` 的 CI 通过，不能只因为版本号存在就称为稳定。

## 升级

1. 记录正在运行的会记P版本、commit、模型 revision 及配置。
2. 备份一致性 SQLite、uploads、transcripts、声纹库、JWT secret 和配置；运行中的 SQLite 使用备份接口或一致性快照。
3. 在新代码目录构建，在独立数据副本和独立端口完成验收；先验证数据迁移。
4. 停止旧应用，切换到已验收的二进制或镜像，保持持久化目录路径。
5. 检查登录、用户隔离、播放、转写、纪要历史；保留旧代码和备份，不删除旧目录。

## 回退

若只变更应用且数据库兼容，可切回旧应用。若迁移不向后兼容，需恢复升级前的**一致性数据副本**并在隔离目录验证，再切换服务。回退不能靠把旧二进制硬套到新数据库。不要用递归删除恢复环境。

## English summary

The project remains Unreleased. Tag pushes produce reviewable Linux amd64 artifacts and checksums after automated checks. Stable promotion additionally requires fresh GPU installation, application acceptance, and upgrade/rollback validation. Model weights and user data are never bundled. Back up the database and associated files consistently; rollback may require restoring the pre-upgrade data snapshot.
