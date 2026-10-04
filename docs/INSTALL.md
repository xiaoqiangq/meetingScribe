# 构建和运行

## 网站源码构建

需要 Go 1.24.4（以 go.mod 为准）、Node.js 与 npm、FFmpeg。前端构建先于 Go 构建，因为 Go 会嵌入静态文件。

```bash
cd web/frontend
npm ci
npm run build
cd ../..
python3 scripts/copy_frontend.py
go build -o bin/huiji-p ./cmd/server
```

`copy_frontend.py` 只在目标静态资源目录为空时复制，不清理已有目录；重复构建请使用新的源码副本，或自行处理旧产物。

将 `.env.example` 复制为 `.env`，配置运行路径，然后启动 `bin/huiji-p`。配置不是秘密的模板；真实 JWT、API 密钥留在本机。服务启动会检查模型环境，未配置模型时可能出现适配器初始化错误；仅构建网站不代表模型可运行。

## 当前中文模型运行目录

服务用 `WHISPERX_ENV` 定位运行器。Linux GPU 是目前验证过的环境；启动脚本位于仓库之外并使用部署者自己的路径。

```text
WHISPERX_ENV/
├── nemotron3/
│   ├── .venv/bin/python
│   ├── Nemotron-3-Diarization.nemo
│   ├── nemotron3_diarize.py
│   └── topic-native-runtime/{native_topic_recommendations.py,native_identifier.py,trial.py}
├── qwen3-asr-env/bin/python
├── funasr-runtime/{qwen3_transcribe.py,chunk_manager.py,transcribe.py}
├── qwen3-models/（ASR 和 ForcedAligner 本地目录）
└── modelscope-cache/models/（FSMN-VAD 等本地目录）
```

`runtime/funasr/funasr_transcribe.py` 安装为 `funasr-runtime/transcribe.py`；其余脚本保持文件名。具体模型目录名称以运行脚本中的 `MODEL_ROOT`、`VAD_DIR` 和加载代码为准。需要独立 Python 环境；不要向已有工作环境无条件安装最新版依赖。

| 模型 | 当前用途 |
| --- | --- |
| nvidia/Nemotron-3-Diarization | 八通道说话人分离、原生特征 |
| Qwen/Qwen3-ASR-1.7B | 转写 |
| Qwen/Qwen3-ForcedAligner-0.6B | 字词对齐 |
| iic/speech_fsmn_vad_zh-cn-16k-common-pytorch | 语音活动检测 |

Qwen 桥接代码针对 FunASR 1.4.16 做了时间单位兼容，升级后必须复核。Nemotron 原生推荐和登记代码校验指定 checkpoint SHA256，其他版本权重不能直接替换。模型依赖完整锁定及新机器一键安装尚待整理；本说明不保证任意平台可直接复现 GPU 环境。

## 账号和部署

首次启动空数据库时创建初始管理员；有账号后关闭公开注册，由管理员创建普通用户。普通用户仅访问自己的项目和纪要，管理员管理账号及共享模型配置和声纹库。

本地测试用 localhost；对外服务配置 HTTPS、允许的来源和安全 Cookie。仓库内继承的 Docker 配置是上游构建入口，并不自动提供当前中文模型环境。代码 push 不会自动部署服务器。
