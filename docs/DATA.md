# 数据、上传范围与备份

代码仓库不保存 WAV、逐字稿、纪要、声纹样本、SQLite、API 密钥、Python 环境、缓存、模型权重和历史程序。`.gitignore` 是防误提交的一层保护；已经被 Git 跟踪的文件不会因为新增忽略规则自动解除跟踪。

默认 SQLite 是 `data/scriberr.db`，上传目录是 `data/uploads`，转写目录是 `data/transcripts`；可由 DATABASE_PATH、UPLOAD_DIR、TRANSCRIPTS_DIR 改写。账号权限通过数据库所有者字段隔离，不是每个账号独立物理目录。

声纹库由 TOPIC_NATIVE_REFERENCE_ROOT 指向运行数据目录，登记样本和特征留在服务器。NATIVE_VOICEPRINT_SEED_ROOT 是可选初始化库，仓库不包含任何个人样本，也不自带已知人员。

备份需另行包含数据库及对应 uploads、transcripts、声纹目录、配置与 JWT secret。运行中的 SQLite 应使用 SQLite 备份接口或一致性快照，不能只复制主文件而忽略 WAL。代码备份不等于会议数据备份。

项目删除后仍可能有转写产物及软删除记录；当前没有完善的按用户容量配额。不要把 GitHub 当作会议数据清理或备份机制。
