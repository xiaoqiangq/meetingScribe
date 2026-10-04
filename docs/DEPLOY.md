# 会记P Docker 部署

[English](DEPLOY.en.md) · [原生安装](INSTALL.md) · [验收](VALIDATION.md)

## 部署入口

默认 `docker-compose.yml` 构建本仓库的会记P代码，不拉取原版 Scriberr。其他三个 Compose 文件保留为兼容入口，内容相同；`Dockerfile` / `Dockerfile.cuda` 均提供 Linux CUDA 应用运行环境。

镜像包含网站程序、Python 3.12、ffmpeg、uv、运行脚本；**不包含模型权重和 Qwen/NeMo 专用虚拟环境**。首次准备这些环境需要联网和额外磁盘。此 Docker 配置尚未完成镜像构建与 GPU 全链路验收，不能视为已经验证的一键部署包。

要求：Linux NVIDIA GPU、可用 Docker daemon、Docker Compose 2.30+、NVIDIA Container Toolkit；先确认 `docker info` 和 `nvidia-smi` 正常。

## 1. 新目录准备与构建

仓库根目录执行，使用新的数据目录。将 UID/GID 设置为你的服务账号，避免容器写入权限问题。

```bash
mkdir -p data/whisperx-env
export HUIJI_UID="$(id -u)"
export HUIJI_GID="$(id -g)"
docker compose config --quiet
docker compose build
```

默认只绑定宿主 `127.0.0.1:8080`。外部访问通过 HTTPS 反向代理；设置 `ALLOWED_ORIGINS` 为真实地址、`SECURE_COOKIES=true`。改变绑定范围应由部署管理员决定。

## 2. 在容器内准备模型环境

不能直接挂载在另一绝对路径创建的 venv：其中解释器路径可能失效。应在容器的 `/app/whisperx-env` 路径安装。

```bash
docker compose run --no-deps --entrypoint /bin/bash huiji-p
```

进入后：

```bash
export WHISPERX_ENV=/app/whisperx-env
python3 scripts/install_runtime_files.py --runtime "$WHISPERX_ENV"
```

接着执行 [安装指南步骤 4–7](INSTALL.md#4-qwen-识别与对齐环境)，容器使用 `python3`（版本为 3.12），路径仍为 `/app/whisperx-env`；选择驱动兼容的 CUDA wheel。完成后：

```bash
python3 scripts/check_runtime.py --runtime "$WHISPERX_ENV"
exit
```

容器内通过 pip/uv 安装的内容保存到挂载目录。安装失败请保留日志，用新目录重试；本文没有删除或覆盖旧环境的步骤。

## 3. 启动与验收

```bash
docker compose up -d
docker compose logs --tail 100 huiji-p
curl --fail http://127.0.0.1:8080/health
```

首次创建管理员并配置转写 Profile；按照 [验收清单](VALIDATION.md) 完成短录音、长录音、人物推荐、用户隔离和纪要历史验证。健康接口不能代替模型推理验收。

## 持久化、停止与升级

`HUIJI_DATA_DIR` 默认 `./data`；`HUIJI_RUNTIME_DIR` 默认 `./data/whisperx-env`。数据库、录音、逐字稿、声纹库、JWT secret 和模型环境都保存到宿主挂载目录，容器重建不是数据备份。

```bash
docker compose stop
```

升级及回退见 [发布规范](RELEASE.md)。不要对生产目录使用删除卷或清理目录命令。现有服务器的 Singularity 部署继续使用原有流程，不因仓库新增 Docker 配置自动迁移。
