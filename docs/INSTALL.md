# 安装与运行

[English](INSTALL.en.md) · [首页](../README.md) · [模型](MODELS.md)

## 0. 安装范围与准备

以下给出 **Ubuntu 24.04 / Linux NVIDIA GPU** 的参考步骤。已核对当前 A100 运行环境，并验证代码构建、辅助脚本和现有环境检查；尚未在全新服务器重新下载全部依赖和权重完成端到端安装验收。已有运行环境请先用独立目录，不覆盖正在工作的 Python 环境。

| 项目 | 要求或规划参考 |
| --- | --- |
| 操作系统 | Linux；下面系统命令面向 Ubuntu 24.04 |
| GPU | NVIDIA CUDA；已验证 A100，其他卡需自行做样本测试 |
| 显存 | 建议先以 16 GB 或更大作为规划参考，不是已测试的最低显存；批量大小和并发会改变峰值 |
| 内存 / 磁盘 | 建议 32 GB RAM、60 GB 以上可用磁盘并另留会议数据空间；不是精确最低配置 |
| 构建工具 | Go 1.24.4 或兼容 go.mod 的工具链；Node.js 22.12+ 与 npm |
| Python | 3.12，Qwen 与 NeMo 分开环境 |
| 网络 | 首次安装访问 PyPI、GitHub、Hugging Face / ModelScope；本地权重齐全后可离线推理 |
| 私有仓库 | 使用自己的 GitHub 账号登录后 clone；浏览器登录不等于命令行已认证 |

安装 NVIDIA 驱动后，先确认 `nvidia-smi` 能看到 GPU。PyTorch CUDA wheel 要与驱动及硬件兼容；按照 [PyTorch 官方安装选择器](https://pytorch.org/get-started/locally/) 选择同一渠道的 torch / torchaudio。不要把当前服务器的 CUDA wheel 版本当作所有机器的通用版本。

## 1. 系统依赖和源码

```bash
sudo apt-get update
sudo apt-get install -y git ffmpeg libsndfile1 build-essential python3.12 python3.12-venv python3-dev

git clone https://github.com/xiaoqiangq/huiji-p.git
cd huiji-p
```

另外安装 Go、Node.js 和 uv，使用各自官方渠道。uv 用于上游 WhisperX 的项目环境检测；只安装 Python/pip 不足以让所有适配器初始化。

```bash
go version
node --version
npm --version
uv --version
ffmpeg -version
nvidia-smi
```

## 2. 构建网站

```bash
cd web/frontend
npm ci
npm run build
cd ../..
python3 scripts/copy_frontend.py
go build -o bin/huiji-p ./cmd/server
```

成功条件：`bin/huiji-p` 存在，`internal/web/dist/index.html` 存在。复制脚本拒绝覆盖非空目标；重复构建可换一个新 checkout。编译成功只表示网站可构建，还需下面模型环境。

## 3. 选择独立运行目录

以下命令在仓库根目录执行。本例将模型和 Python 环境放在被 Git 忽略的 `data/whisperx-env`。

```bash
export WHISPERX_ENV="$(pwd)/data/whisperx-env"
mkdir -p "$WHISPERX_ENV"
python3 scripts/install_runtime_files.py --runtime "$WHISPERX_ENV" --dry-run
python3 scripts/install_runtime_files.py --runtime "$WHISPERX_ENV"
```

脚本复制七个运行源码文件，遇到已有且不同的版本会停止，不删除目录、不覆盖旧运行器。目录应由服务账号拥有并可写。容器内的 `WHISPERX_ENV` 必须使用容器能访问的挂载路径，不能填只在宿主存在的路径。

## 4. Qwen 识别与对齐环境

```bash
python3.12 -m venv "$WHISPERX_ENV/qwen3-asr-env"
"$WHISPERX_ENV/qwen3-asr-env/bin/python" -m pip install --upgrade pip
```

先在此环境按官方选择器安装 CUDA 版 PyTorch。例如支持 CUDA 12.6 wheel 的新环境可使用下述参考命令；该选择不等于完整链路已在这套全新依赖上验收。

```bash
"$WHISPERX_ENV/qwen3-asr-env/bin/python" -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu126
"$WHISPERX_ENV/qwen3-asr-env/bin/python" -m pip install -r runtime/requirements-qwen.txt
"$WHISPERX_ENV/qwen3-asr-env/bin/python" -m pip check
"$WHISPERX_ENV/qwen3-asr-env/bin/python" -c "import torch,funasr,transformers; print(torch.__version__,torch.version.cuda,torch.cuda.is_available()); print(funasr.__version__,transformers.__version__)"
```

成功条件：CUDA 为 True，FunASR 为 1.4.16、Transformers 为 4.57.6，`pip check` 无冲突。桥接有 FunASR 时间单位兼容逻辑，不能未经复核直接升级。

## 5. Nemotron 独立环境

```bash
python3.12 -m venv "$WHISPERX_ENV/nemotron3/.venv"
"$WHISPERX_ENV/nemotron3/.venv/bin/python" -m pip install --upgrade pip setuptools wheel Cython packaging
"$WHISPERX_ENV/nemotron3/.venv/bin/python" -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu126
"$WHISPERX_ENV/nemotron3/.venv/bin/python" -m pip install -r runtime/requirements-nemotron.txt
"$WHISPERX_ENV/nemotron3/.venv/bin/python" -m pip check
"$WHISPERX_ENV/nemotron3/.venv/bin/python" -c "import torch; from nemo.collections.asr.models import SortformerEncLabelModel; print(torch.__version__,torch.cuda.is_available())"
```

这里固定 NVIDIA-NeMo/Speech 的源码 commit，而非仅固定显示为 3.0.0 的包版本。现有部署曾通过 `.pth` 复用另一环境的通用依赖；新服务器应安装完整依赖，不复制指向旧服务器路径的 `.pth` 文件。CUDA wheel 与步骤 4 一样，按你的机器调整。

## 6. FunASR 适配器的兼容目录

当前 Go 代码的 FunASR `PrepareEnvironment/IsReady` 仍检查基础 WhisperX/FunASR 目录，即使本次任务选 Qwen。漏掉此步骤可能出现“Qwen 已装好但模型未就绪”。

```bash
uv init --bare --python 3.12 "$WHISPERX_ENV/WhisperX"
uv add --project "$WHISPERX_ENV/WhisperX" 'whisperx==3.8.7rc1'
uv run --native-tls --project "$WHISPERX_ENV/WhisperX" python -c "import whisperx; print('WhisperX ready')"

python3.12 -m venv "$WHISPERX_ENV/funasr-compare"
"$WHISPERX_ENV/funasr-compare/bin/python" -m pip install 'funasr==1.4.16' kaldi-native-fbank
```

这是新目录参考安装；已有部署复用其现成环境即可。基础目录检查存在，不代表 Qwen 路径会改用 Whisper 模型。服务还会尝试初始化其他继承适配器；Canary / Parakeet / PyAnnote 不属于本文标准链路。它们的下载、授权或初始化失败应与 Qwen/Nemotron 的实际状态分别查看。

## 7. 下载模型并检查路径

```bash
python3 scripts/download_models.py --runtime "$WHISPERX_ENV" --dry-run
"$WHISPERX_ENV/qwen3-asr-env/bin/python" scripts/download_models.py --runtime "$WHISPERX_ENV"
python3 scripts/check_runtime.py --runtime "$WHISPERX_ENV"
```

下载器使用 Hugging Face 下载 Qwen 与固定 revision 的 Nemotron `.nemo`，使用 ModelScope 下载 VAD / CAM++。Nemotron SHA256 必须为：

```text
867c53f552998f772e5b5e5c082962ae85ee7ca5669c2bc17d7f615133d4e96d
```

Qwen/VAD 下载当前模型快照；下载后请记录实际 revision 与依赖结果，下载器不是完整的内容寻址锁文件。若网络受限，可设置经你确认的 Hugging Face 镜像或按 [Qwen 官方方式](https://github.com/QwenLM/Qwen3-ASR#download) 从 ModelScope 下载 Qwen 到相同目录。离线环境中不运行下载器，预先在联网环境准备完整目录后复制。

```text
WHISPERX_ENV/
├── qwen3-asr-env/bin/python
├── qwen3-models/
│   ├── Qwen3-ASR-1.7B/{config.json, 模型权重, tokenizer 等}
│   └── Qwen3-ForcedAligner-0.6B/{config.json, 模型权重, tokenizer 等}
├── funasr-runtime/{qwen3_transcribe.py,chunk_manager.py,transcribe.py}
├── nemotron3/
│   ├── .venv/bin/python
│   ├── Nemotron-3-Diarization.nemo
│   ├── nemotron3_diarize.py
│   └── topic-native-runtime/{native_topic_recommendations.py,native_identifier.py,trial.py}
├── modelscope-cache/models/
│   ├── iic--speech_fsmn_vad_zh-cn-16k-common-pytorch/snapshots/master/
│   └── iic--speech_campplus_sv_zh-cn_16k-common/snapshots/master/
├── WhisperX/.venv/bin/python
└── funasr-compare/lib/python3.12/site-packages/
```

成功条件：检查脚本最后输出 `ready: true`。这只验证路径、Nemotron 校验和、关键导入及 CUDA，不替代实际转写验收。

## 8. 配置与启动

```bash
cp .env.example .env
```

编辑 `.env`：本地使用 127.0.0.1:8080；`WHISPERX_ENV` 改为步骤 3 的绝对目录。`DATABASE_PATH`、`UPLOAD_DIR`、`TRANSCRIPTS_DIR` 与 `TOPIC_NATIVE_REFERENCE_ROOT` 同属你的持久化 `data` 目录。JWT secret 默认首次生成并写入 `data/jwt_secret`，需随备份保留，不提交 Git。

```bash
./bin/huiji-p
```

另开终端：

```bash
curl --fail http://127.0.0.1:8080/health
```

成功条件：`status` 为 `healthy`，浏览器打开 http://127.0.0.1:8080 能看到会记P。`/health` 是网页服务健康，不代表所有模型可用；必须检查日志、模型状态和真实短样本。

外部访问时配置绑定地址与 ALLOWED_ORIGINS，并用 HTTPS 反向代理及 `SECURE_COOKIES=true`。HTTP 本地测试才使用 false。前台启动适合测试，正式运行可由你自己的 systemd/container 管理；不要拿继承的上游 Docker Compose 当作已包含全部中文模型的部署包。

## 9. 首次操作和最小验收

1. 空数据库创建管理员；已有账号后由管理员创建用户，公开注册关闭。
2. 管理员建立 Transcription Profile：FunASR 系列 → Qwen3-ASR-1.7B、CUDA、Nemotron、Chunk Manager。若下拉为空，先创建配置，或使用高级转写。
3. 用一段你有权处理的 30–60 秒清晰录音试转写，确认文字、时间和试听定位。
4. 管理员打开声纹库，登记一个人的 10–180 秒样本，建议 20–60 秒清晰单人声音；不随仓库提供任何真人库。
5. 长音频测试设置一个分界点，检查 `topic1/speaker_*` / `topic2/speaker_*`，试听确认人物联系和姓名。
6. 在设置中配置本地或外部 LLM，建立/选择纪要模板，检查带来源版、清洁版及历史版本。

## 10. 不启动网页的本地模型调用

输入转成 16 kHz 单声道，输出使用一个新的目录：

```bash
mkdir -p local-result-001
ffmpeg -nostdin -i your-meeting.wav -ac 1 -ar 16000 local-result-001/input.wav
"$WHISPERX_ENV/nemotron3/.venv/bin/python" "$WHISPERX_ENV/nemotron3/nemotron3_diarize.py" local-result-001/input.wav local-result-001/diarization.json --device cuda
"$WHISPERX_ENV/qwen3-asr-env/bin/python" "$WHISPERX_ENV/funasr-runtime/qwen3_transcribe.py" local-result-001/input.wav local-result-001/transcript.json --chunk-manager-sortformer local-result-001/diarization.json
```

产生模型 JSON、Chunk 计划和原始对齐记录；这两个脚本不执行网页中的完整分句角色归整、跨 topic 用户确认或纪要。完整用户流程通过网站使用。

## 故障排查

| 现象 | 检查 |
| --- | --- |
| Clone 失败 | 私有仓库账号认证，GitHub 连接授权不自动登录本机 Git |
| CUDA False | NVIDIA 驱动、wheel CUDA 版本、容器 GPU 映射 |
| RoPE / strict load 报错 | NeMo 源码 commit、正确 `.nemo` 和 SHA256 |
| Qwen 目录不存在 | qwen3-models 两个模型的 config/tokenizer/完整权重 |
| VAD config.yaml 不存在 | ModelScope 缓存必须落在固定 snapshots/master 路径 |
| Qwen 已装但 FunASR not ready | 步骤 6 的 WhisperX 与 funasr-compare 检查 |
| 姓名候选缺失 | 先登记清晰单人样本；检查原生 helper、sample-plan.json 与日志 |
| Profile 下拉为空 | 管理员创建转写配置，或先使用高级转写 |
| 时间戳异常 | FunASR 1.4.16 兼容补丁、局部/全局秒数不能重复加偏移 |
| 模型 out of memory | 缩小并发/批量；不能仅由磁盘权重大小推算显存 |
| 纪要失败 | LLM 连接、模型名、API 密钥、上下文长度；ASR 与 LLM 是独立流程 |

## 本次验证边界

辅助脚本通过语法检查与 dry-run；文件复制在独立临时目录验证，并拒绝不同版本覆盖。现有 A100 运行环境用同一检查脚本只读验证。未改动现有模型/数据库、没有重启服务；新服务器安装及完整下载仍应按步骤 9 验收。

## 容器部署与版本管理

[会记P Docker 入口](DEPLOY.md) · [验收状态](VALIDATION.md) · [发布和回退](RELEASE.md)
