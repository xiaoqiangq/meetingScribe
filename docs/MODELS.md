# 模型与能力

[English](MODELS.en.md) · [安装](INSTALL.md) · [架构](ARCHITECTURE.md)

## 当前推荐流程

| 模型 | 用途 | 输入 → 输出 | 参数 / 权重体积 |
| --- | --- | --- | --- |
| Nemotron-3-Diarization | 区分说话人及重叠发言 | 音频 → speaker 标签及起止时间 | 约 100M / 199 MB |
| Qwen3-ASR-1.7B | 识别讲话内容 | 音频块 → 文字 | 1.7B / 约 4.70 GB |
| Qwen3-ForcedAligner-0.6B | 对齐已有文字 | 同一音频块 + 文字 → 字词时间 | 0.6B / 约 1.84 GB |
| FSMN-VAD | 找出有声与静音区域 | 音频 → 区间 | 本部署权重约 1.72 MB |
| 用户配置的 LLM | 生成会议纪要 | 逐字稿、当前人物名称、模板 → 纪要 | 由服务商及用户配置决定 |

体积为既有部署的主要权重文件大小，使用十进制单位；不包括 Python、CUDA、缓存、辅助文件，也不是显存需求。实际下载目录大小可能不同。

## 为什么选用这些模型

### Qwen3-ASR-1.7B：语言与口音覆盖广

官方支持30种语言、22种中文方言/口音以及多地区英语口音，并报告复杂声学输入下的识别能力。开放权重支持本地推理，也便于检查集成逻辑。[官方模型卡](https://huggingface.co/Qwen/Qwen3-ASR-1.7B)

这些能力使其适合作为中文会议及地域口音发言的转写基础，但不代表任意方言、噪声条件下都能准确识别。**当前桥接提供自动检测及ASR与对齐器共同支持的11种语言选择**，短英文样本已通过真实模型测试，其他语言仍需单独验收。上游支持离线与流式推理，网站目前提供上传录音后处理的流程。

### NVIDIA Nemotron-3-Diarization：较小规模的上下文分人模型

约100M参数，单次最多8个说话人通道，预测匿名人物活动及重叠发言。Arrival-Order Speaker Cache保留早期人物信息，FIFO队列提供近期声学上下文；同一checkpoint可配置不同输入缓冲，并支持分块处理长音频。[官方模型卡](https://huggingface.co/nvidia/Nemotron-3-Diarization)

在MeetingScribe中，它无需预先登记参会者便可输出人物时间轴；各topic独立运行，可以缩小发言阵容变化时的追踪范围。较小checkpoint有利于多模型组合部署，但参数量和文件体积不等于运行显存或速度保证。模型支持流式，不代表网页已提供实时分人；人物姓名仍需后续复核。

### Qwen3-ForcedAligner-0.6B：把识别内容落实到时间轴

官方支持11种语言，以及不超过5分钟音频内的给定文字单元对齐。MeetingScribe将ASR使用的同一短音频块交给对齐器，生成字词时间，用于高亮、Listen跳转、结合Nemotron区间归属人物及padding去重。[官方模型卡](https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B)

内容识别与时间对齐分开，便于分别检查文字和定位。对齐器不能自行修正错词、验证姓名，也不能独立解决多人重叠的识别问题。

### FSMN-VAD：轻量的语音边界信号

FSMN-VAD检测语音区间，本部署主要权重约1.72 MB。它提供语音/静音边界，帮助Chunk Manager寻找停顿。流程保留连续块内的静音，避免把分散语音直接拼接，时间定位仍对应原始录音。[模型卡](https://huggingface.co/funasr/fsmn-vad) · [FunASR实现](https://github.com/modelscope/FunASR)

VAD判断的是语音活动，不负责人物身份或会议话题；噪声和轻声仍可能影响边界。

### 组合后的价值

这些组件连接了**说了什么、谁在何时发言、应该跳到哪里试听**。再结合Chunk Manager与人工身份确认，形成可复核的会议工作流。[验证记录](VALIDATION.md)说明当前项目验证范围；官方模型指标不等于MeetingScribe端到端效果。

## Nemotron：分人及原生特征推荐

官方模型属于 Sortformer 系列，输入 16 kHz 单声道音频，通过声学编码和说话活动预测输出说话人时间区间。流式记忆维护前后语音上下文；单次运行最多提供 8 个说话人通道，标签按首次出现次序组织。它不会直接输出真实姓名。

本项目长模式先按手动时间点划分 topic，依次运行独立的 Nemotron 任务。`topic1/speaker_0` 与 `topic2/speaker_0` 最初代表两个独立人物标签。恢复全局时间轴不等于自动确认它们是同一个人。单个 topic 的 8 通道限制也不能通过改名消除。

姓名和跨 topic 联系来自项目扩展：从清晰、无重叠的原始语音片段中，用**同一 Nemotron checkpoint**提取原生特征，再与登记样本或其他 topic 人物特征比较。当前流程**不用 TitaNet**。这是一套候选推荐策略，并不是 NVIDIA 官方提供的姓名识别或经过独立评测的声纹验证模型。

- 一般从每个人物取最多 5 个清晰窗口，每个约 3–6 秒；无可靠片段时可不给建议。
- 声纹库上传样本允许 10–180 秒，建议 20–60 秒清晰单人讲话；登记样本会截取多个不重叠片段。
- 目前任务会重新读取登记音频并提取参考特征，因此库人数增加会增加处理时间；不能称为完全缓存的向量检索。
- 麦克风、距离、噪声、音量、情绪及多人重叠都可能降低推荐质量。相似度不是“姓名正确概率”。
- 用户试听后确认联系或姓名；原始分人标签保留。若一个标签已经混入两个人，仅修改姓名不能修复所有错误片段。

## Qwen：转写与对齐

ASR 负责内容，ForcedAligner 负责把给定文字放到音频时间轴。对齐器不能保证文字正确，也不负责区分人物。本项目通常用约 10–30 秒核心块并保留 padding，按字词中点去重，再按标点、停顿及人物归属形成自然分句。

官方 ASR 支持 30 种语言及 22 种中文方言；官方对齐器支持 11 种语言。**当前Qwen桥接提供自动检测，以及zh/en/yue/fr/de/it/ja/ko/pt/ru/es显式选择**；新配置默认自动检测，既有zh配置保留，Python CLI未传--language仍默认zh以兼容旧脚本。不能把语言选项理解成全部语言已经逐一验收。没有对本项目进行统一的准确率或实时倍速评测；速度取决于 GPU、音频长度、topic 数、库人数与并发。

## 兼容组件与可选后端

| 组件 | 在当前项目中的位置 |
| --- | --- |
| CAM++ | 旧的非 Chunk Manager 路径可能使用其兼容分人流程；标准 Nemotron 路径的姓名推荐不使用 CAM++ 特征 |
| WhisperX / FunASR 兼容环境 | 当前适配器的就绪检查仍依赖这些目录；安装指南包含配置步骤 |
| Paraformer、SenseVoice、Parakeet、Canary 等适配器 | 继承的可选后端；有适配器不代表对应模型已安装或完成本项目验收 |
| OpenAI 等云转写 | 可选后端，使用时按配置把音频交给外部服务 |
| 本地或外部 LLM | 会议纪要服务，接收文字及人物信息；外部 LLM 会收到这些文字 |

## 可复现信息

Nemotron checkpoint 固定为：

```text
repo: nvidia/Nemotron-3-Diarization
revision: f667ed73aee57d40cc39428eb768b4fd87a0a29e
file: Nemotron-3-Diarization.nemo
sha256: 867c53f552998f772e5b5e5c082962ae85ee7ca5669c2bc17d7f615133d4e96d
NeMo source: 1688cc3d6a9ade854f544987810c53f605dc86fc
```

Qwen 桥接当前核验版本：Python 3.12、qwen-asr 0.0.6、FunASR 1.4.16、Transformers 4.57.6、Accelerate 1.12.0。核心依赖见 `runtime/requirements-*.txt`；它们不是完整的传递依赖锁文件。现有服务器使用特殊 CUDA/PyTorch 环境，新机器应安装与驱动匹配的官方 PyTorch 组合。

下载脚本固定 Nemotron revision 和校验值；Qwen / ModelScope 模型未固定 revision。正式复现时还应记录它们的下载 revision、完整依赖版本、GPU 与驱动版本。

## 上游资料与授权

- [Nemotron 模型卡](https://huggingface.co/nvidia/Nemotron-3-Diarization)：Open Model Definition and Weights License 1.1。
- [Qwen ASR 模型卡](https://huggingface.co/Qwen/Qwen3-ASR-1.7B)、[对齐器模型卡](https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B)、[官方代码](https://github.com/QwenLM/Qwen3-ASR)：模型卡标注 Apache-2.0。
- [FSMN-VAD 模型](https://huggingface.co/funasr/fsmn-vad)、[FunASR](https://github.com/modelscope/FunASR)。

本仓库代码的 LICENSE 不替代各模型和依赖的许可证。权重不包含在仓库中。
