# 数据、上传范围与备份

代码仓库不保存 WAV、逐字稿、纪要、声纹样本、SQLite、API 密钥、Python 环境、缓存、模型权重和历史程序。`.gitignore` 是防误提交的一层保护；已经被 Git 跟踪的文件不会因为新增忽略规则自动解除跟踪。

默认 SQLite 是 `data/scriberr.db`，上传目录是 `data/uploads`，转写目录是 `data/transcripts`；可由 DATABASE_PATH、UPLOAD_DIR、TRANSCRIPTS_DIR 改写。账号共用数据库，通过所有者字段控制权限；录音按下述用户目录组织。

新录音在 `UPLOAD_DIR/<用户目录>/` 中按项目 UUID 保存。普通安全用户名直接作为
目录名，例如 `uploads/alice/<项目UUID>.wav`；快速转写在该用户的
`quick_transcriptions/` 子目录，多轨文件在项目 UUID 子目录。
目录名持久保存在 `users.upload_directory`，修改用户名不移动历史目录；
不安全、保留或发生目录名冲突的账号使用 `_user-<用户ID>`。
音频、视频提取、普通录音、实时录音、直接提交和 YouTube 均使用这一规则。
服务器 dropzone 没有登录会话，明确归属最早创建的账号；该账号禁用时拒绝导入。
物理目录便于查看，API 仍必须校验 `owner_id`；不是 Linux 用户权限隔离。
转写结果仍放 `TRANSCRIPTS_DIR/<项目UUID>/`，纪要、笔记及转写正文继续保存在数据库中。
声纹库位置不随用户上传目录变化。

## 现有录音整理

旧路径继续兼容，不在启动时自动移动录音。使用
`scripts/migrate_user_uploads.py` 明确迁移：默认仅预览，指定物理 uploads 根目录、
数据库中记录的 uploads 前缀、数据库路径和一个新的私人报告文件。
两种前缀可以不同，以支持运行隔离环境的路径映射。

```bash
python3 scripts/migrate_user_uploads.py \
  --database /path/to/data/scriberr.db \
  --uploads-root /path/to/data/uploads \
  --stored-uploads-root /app/data/uploads \
  --report /private/path/uploads-preview.json
```

核对预览中的用户映射、缺失路径、无归属文件及空间需求后，停止应用、监控、
实时服务和其他上传写入者。实际应用增加 `--apply --services-stopped` 和
`--backup /private/path/new-sqlite-backup.db`，并使用另一个新的报告路径。
脚本通过 SQLite 备份 API 保存含 WAL 内容的数据库副本；逐文件复制和 SHA256
校验后，在一个事务内修改音频、合并音频、多轨和快速清理路径及用户目录映射。
报告包含账号和路径信息，备份还包含私有业务数据，均不得上传 Git。

脚本不删除或覆盖原录音，不移动无归属文件，不恢复已删除项目，遇到冲突、
越界路径、符号链接或活动任务会拒绝迁移。已缺失文件会列入报告并保留原路径。
原文件和新副本暂时会同时占用空间；需要清理时由用户手动处理。
中断复制可能留下不完整的新副本，后续执行会拒绝内容冲突，不自动覆盖或删除。
回退时停写并根据报告中的 old/new 路径恢复数据库指针；只有在备份之后没有新数据
且确认数据库兼容时，才可考虑恢复完整数据库备份。保留原文件、新文件和报告。

声纹库由 TOPIC_NATIVE_REFERENCE_ROOT 指向运行数据目录，登记样本和特征留在服务器。NATIVE_VOICEPRINT_SEED_ROOT 是可选初始化库，仓库不包含任何个人样本，也不自带已知人员。

备份需另行包含数据库及对应 uploads、transcripts、声纹目录、配置与 JWT secret。运行中的 SQLite 应使用 SQLite 备份接口或一致性快照，不能只复制主文件而忽略 WAL。代码备份不等于会议数据备份。

项目删除后仍可能有转写产物及软删除记录。不要把 GitHub 当作会议数据清理或备份机制。
