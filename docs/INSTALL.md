# 安装 MeetingScribe

[English](INSTALL.en.md) · [首页](../README.zh-CN.md)

推荐使用自动安装：不用在宿主机安装 Go、Node.js、Python，也不用逐条创建模型环境。

## 准备一台 GPU 机器

需要 **Linux x86_64、NVIDIA GPU、可用的 NVIDIA 驱动、Docker Engine、Docker Compose 2.30+ 和 NVIDIA Container Toolkit**。`nvidia-smi` 应能看到显卡，当前账号应能执行 `docker info`。

建议预留 16 GB 以上显存、32 GB 内存、60 GB 以上磁盘及录音空间。这是规划参考，最低配置尚未实测。首次安装需要访问 GitHub、PyPI、Hugging Face、ModelScope 和 PyTorch 下载站；下载量较大，请等待终端中的进度。

## 安装并启动

```bash
git clone https://github.com/xiaoqiangq/meetingScribe.git
cd meetingScribe
bash install.sh
```

私有仓库需要先完成命令行 GitHub 认证。

脚本自动构建网站、检查容器 GPU、安装独立模型环境、下载模型、检查 CUDA 与模型文件，然后启动服务。遇到错误会停止；修复终端提示的问题后，重新执行 `bash install.sh` 即可复用已完成的依赖步骤和下载缓存。

成功后打开 **http://localhost:8080**。如果装在远程服务器，先在自己的电脑执行端口转发：

```bash
ssh -L 8080:127.0.0.1:8080 your-user@your-server
```

再打开本机的 http://localhost:8080。

## 第一次使用

1. 在网页创建管理员账号。
2. 在转写配置中选择 **FunASR → Qwen3-ASR-1.7B、CUDA、Nemotron、Chunk Manager** 并保存；也可先使用高级转写。
3. 上传一段 30–60 秒录音，确认文字、说话人和点击文字后的播放位置。
4. 需要会议纪要时，在设置中填写自己的本地或外部 LLM 服务。

自动安装覆盖上传录音转写、说话人分离、对齐及声纹辅助功能；实时麦克风转写还需要 [实时服务](REALTIME.md) 的独立 vLLM 环境。

## 停止、启动和排错

```bash
# 查看日志
docker compose --env-file /dev/null -p meetingscribe-quickstart -f docker-compose.quickstart.yml logs --tail 100 huiji-p

# 停止；保留录音、数据库、模型和环境
docker compose --env-file /dev/null -p meetingscribe-quickstart -f docker-compose.quickstart.yml stop

# 再次启动；无需重新安装
docker compose --env-file /dev/null -p meetingscribe-quickstart -f docker-compose.quickstart.yml up -d
```

数据存放在此项目的 Docker 持久卷 `meetingscribe-quickstart_data` 与 `meetingscribe-quickstart_runtime` 中，升级前需备份。安装器使用独立项目，不读取已有部署的 `.env`，也不迁移旧数据；已有运行服务请按 [部署与升级说明](DEPLOY.md) 操作。

| 提示 | 处理 |
| --- | --- |
| 找不到 Docker / NVIDIA 驱动 | 先完成上面的机器准备 |
| 容器看不到 GPU | 检查 NVIDIA Container Toolkit 和驱动是否支持 CUDA 12.6 |
| 下载失败 | 检查到下载站的网络，修复后重跑安装命令 |
| 8080 已占用 | 使用 `HUIJI_PORT=8081 ALLOWED_ORIGINS=http://localhost:8081 bash install.sh`，之后管理命令也使用相同变量 |
| 已有服务正在运行 | 安装器拒绝修改运行中的环境；查看日志，升级按部署说明操作 |

需要源码开发、自定义 CUDA 或手工排错时，查看 [高级手动安装](INSTALL.native.md)。对外开放访问、HTTPS 和备份见 [部署说明](DEPLOY.md)。

验证边界：安装器的自动化检查不等于录音推理验收；全新 Linux GPU 主机上的完整下载、安装和转写仍待独立验收。当前开发机器无法完成该项 GPU 验证。
