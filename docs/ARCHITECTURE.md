# 架构、时间轴与人物规则

[English](ARCHITECTURE.en.md) · [首页](../README.zh-CN.md)

## 完整流程图

```text
完整音频 ──┬──→ 短音频：整段运行 Nemotron
          │                   │
          ├──→ 长音频：按手动时间点划分 topic
          │                   ↓
          │       各 topic 串行运行 Nemotron（Sortformer 系列）
          │       每个 topic 独立缓存、独立说话人标签
          │                   ↓
          │       恢复完整音频时间轴，保留各 topic 人物标签
          │                   │
          │                   ├──→ 全局说话人时间区间 ───────────────┐
          │                   │                                    │
          │                   └──→ 各 topic 人物的清晰语音片段      │
          │                                      ↓                 │
          │                           Nemotron 自身生成临时特征     │
          │                           （同一 checkpoint，不用 TitaNet）│
          │                                      ↓                 │
          │                       声纹库姓名候选 + 跨 topic 人物联系 │
          │                              保存，等待用户确认         │
          │                                                        │
          └──→ FSMN-VAD ──→ 有声/静音区间 ──┐                       │
                                            ↓                       │
                              Chunk Manager（规则切片）←───────────┘
                                            ↓
                            保留静音的连续音频块（含 padding）
                                            ↓
                                 Qwen3-ASR 转写文字
                                            ↓
                    同一音频块 + 对应文字 → ForcedAligner 字词时间
                                            ↓
                  字词时间 × Nemotron 区间 → 原始逐字角色（兜底）
                                            ↓
                      核心区间按字词中点去重 → 全局文字串联
                                            ↓
                标点/停顿形成自然分句 → 短分句保护 → 多数角色归整句
                                            ↓
                              网页逐字稿与说话人分段
                                            ↓
                      用户试听姓名候选、跨 topic 人物联系
                                            ↓
                           确认并保存 → 统一人物与姓名
                                            ↓
                              网页显示 / Listen / 导出
                                            ↓
                      按需生成会议纪要（带来源版 / 清洁版）
                                            ↓
                           模板选择 / 历史版本 / 再次查看
```

## 三种“块”各自是什么

| 层次 | 目的 | 缓存/人物 |
| --- | --- | --- |
| 手动 topic | 隔离不同话题或发言阵容的分人任务 | 每个 topic 新进程、新缓存、独立标签 |
| Nemotron 内部 chunk | 模型流式推理和历史声学上下文 | 同一 topic 内保持说话人缓存 |
| Qwen 音频 chunk | 控制 ASR 输入长度，帮助对齐 | 使用全局分人区间，不能另造人物 ID |

长模式 topic 串行运行，边界上下文默认前后约 2 秒，输出裁回各 topic 的核心范围。topic1 的 speaker_0 和 topic2 的 speaker_0 在确认前是不同的本地人物。短模式不用 topic 前缀。

## 时间与文字

1. Nemotron 输出起止秒数，长模式加 topic 起点恢复完整录音时间。
2. FSMN-VAD 提供有声/静音边界；Chunk Manager 结合分人区间和低能量位置规划核心块。
3. 核心块通常约 10–30 秒；末尾可更短。输入保留块内静音，常规 padding 约 0.3 秒，低能量强制切点可用 0.8 秒。
4. ASR 与 ForcedAligner 使用同一输入音频，局部字词时间加输入块起点恢复全局时间。
5. 字词中点落入 core 才保留，去除 padding 的重复文本；用时间和分人区间重叠产生原始逐字角色。
6. 标点与停顿形成句子，短句保护后，多数角色归整句；手动 topic 边界隔离整句角色投票。

图中的 Nemotron → VAD/Chunk 数据依赖不是 topic 并行处理的承诺。当前适配器先得到分人结果，再在 Qwen 桥接内进行 VAD 和切片；图展示完整音频的两条信息路径。

## 原生特征推荐

没有向 Nemotron 的说话人缓存预注入已知声纹。分人之后，选取每个本地人物最多五段分散、约 3–6 秒的清晰片段，剔除其他说话人重叠，并复用同一 checkpoint 的声学特征提取器。

登记样本和会议片段进入同一特征空间，采用特征池化、归一化与相似度排序产生姓名/人物联系候选。中间特征和片段来源保存在任务结果目录。当前 helper 会读取登记样本重新提取参考特征，不能承诺所有样本向量均已跨任务缓存。

用户试听后明确确认并保存，才统一显示姓名或人物。原始分人标签和时间保留。新增声纹样本用于后续匹配，不自动重写历史任务和纪要；匹配失败也不应丢弃已完成的分人结果。

## 纪要与历史

纪要输入来自文字及当前角色/姓名信息，不将音频交给纪要 LLM。模板决定提示要求；带来源版便于核实时间和角色，清洁版去除来源、时间标签及 topic/speaker 注释。不同生成保留历史，已有纪要不会因之后改名自动重新生成。

## 源码定位

| 逻辑 | 文件 |
| --- | --- |
| Nemotron 编排 | `internal/transcription/adapters/nemotron_adapter.go` |
| topic 截取与全局时间 | `internal/transcription/adapters/nemotron_topics.go` |
| VAD / Chunk / Qwen / 对齐 | `runtime/funasr/qwen3_transcribe.py`、`chunk_manager.py` |
| 原生特征 / 人物排序 | `runtime/nemotron/topic-native-runtime/` |
| 登记声纹 | `internal/api/voiceprint_handlers.go`、`native_voiceprint_enroll.py` |
| 分句角色 | `internal/transcription/speaker_clause.go` |
| 纪要版本 | `internal/api/summarize_handlers.go` 和前端 SummaryDialog |
