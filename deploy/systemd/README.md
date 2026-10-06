# Huiji P service and verified backups

Extract the Linux package to `~/huiji-p`; configure `.env`, Python runtimes and model weights first. Adjust unit paths for other locations. These user-systemd templates mirror the tested GPU deployment. Container deployments may keep their own restart policy and run backup helpers on the host.

```bash
mkdir -p ~/.config/systemd/user
cp deploy/systemd/huiji-p.service ~/.config/systemd/user/
cp deploy/systemd/huiji-p-backup.service deploy/systemd/huiji-p-backup.timer ~/.config/systemd/user/
cp deploy/systemd/huiji-p-readiness.service deploy/systemd/huiji-p-readiness.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now huiji-p.service huiji-p-backup.timer huiji-p-readiness.timer
```

Administrators may enable user lingering for operation after logout. `/health` checks database, storage and installed default model; `/live` checks process liveness. The watchdog restarts after three failed checks with a ten-minute cooldown. Set `HUIJI_HEALTH_URL` to your configured host/port.

SQLite backups use the backup API, integrity checks and an in-memory restore test. Daily database backups exclude temporary transcription content. Sunday media archives include ordinary recordings and verify archive hashes. Configure absolute host paths with `HUIJI_DATA_DIR` and `HUIJI_BACKUP_DIR`; default database filename is `scriberr.db`. JWT secrets, provider configuration and model environments require their own protected backup procedure. Retention is manual: these helpers never remove files or directories.

快速转写六小时后不可访问；实际文件后台逐个删除。服务停机时无法执行物理删除，重启后继续。备份排除临时录音内容。请按自己的路径配置模板。
