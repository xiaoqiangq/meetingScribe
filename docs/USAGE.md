# 使用指南

[English quick guide](#english-quick-guide) · [安装](INSTALL.md) · [模型](MODELS.md)

## 1. 账号与转写配置

首次启动后创建管理员账号，由管理员管理其他账号和共享配置。普通用户使用自己的录音、逐字稿和纪要。声纹库及全局服务配置属于管理员管理范围。

先由管理员建立可用的 Transcription Profile，选择已安装的 Qwen3-ASR 与 Nemotron 分人流程。Profile 下拉框不会凭空生成模型配置；没有 Profile 时可通过高级转写设置选择可用参数。先用 30–60 秒样本确认转写、分人及时间跳转正常。

## 2. 短音频与长音频

- **上传短音频**：整段运行 Nemotron，仍可生成姓名候选。
- **上传长音频**：添加手动 topic 分割时间，例如 `43:00`。时间应在录音范围内，按实际话题或人员变化设置。
- 长模式按 topic 串行执行，保持 `topic1/speaker_0` 等独立人物标签。后续 Qwen 分块基于整段时间轴规则，topic 不等于 ASR chunk。

处理时间依赖设备和录音内容。网页可以响应不代表模型已就绪；首次运行可能需要加载权重。

## 3. 试听与人物确认

打开逐字稿，使用播放、高亮及 Listen 定位讲话。先检查同一标签是否主要属于同一个人，再处理推荐：

1. 试听跨 topic 联系两侧的代表片段，确认后统一人物。
2. 试听声纹库的姓名候选，确认后保存姓名；不确定时保留匿名标签。
3. 检查导出和逐字稿显示是否使用确认后的映射。

推荐不自动成为事实。保存人物映射不会重跑分人模型。若某标签混入不同人物，需进一步复核相关片段；仅给整个标签换名无法修复混合。

## 4. 管理声纹库

管理员为每个人上传清晰单人语音并填写名称。允许 10–180 秒，建议 20–60 秒；避免背景人声、音乐和严重混响。系统从样本提取同一 Nemotron checkpoint 的原生特征，用于候选推荐。登记音频是敏感资料，应纳入数据访问和备份管理。

## 5. 会议纪要

在语音页面右上角点击 **会议纪要**，选择 Summarization Templates 中的模板。可使用中文会议纪要（待核实优先）或中文会议纪要（原版）；新安装的模板内容取决于初始化与管理员配置，不能假定生产数据库模板随源码自动复制。

输入是逐字稿文字、当前人物名称/角色信息和模板指令，不是原始音频。外部 LLM 会收到这些文字。生成后提供带来源版本和清洁版本；清洁版去掉时间标签、匿名角色注记及“来源：”内容。

每次生成保存历史版本，切换模板重新生成不会简单覆盖旧纪要。关闭后可再次打开查看历史。确认人物后应重新生成需要更新名称的纪要，历史文档不会因人物改名自动重写。对决议、责任人及日期进行人工核实。

## 6. 数据与维护

参见 [数据与备份](DATA.md)。部署时将数据库、音频、逐字稿、纪要和声纹库放在持久化目录。代码仓库不是录音备份。管理员定期检查磁盘空间，备份后再按产品提供的删除方式处理项目。

## English quick guide

1. Create an administrator, configure installed models and a shared transcription profile, then validate a short recording.
2. Use short upload for whole-recording diarization. Use long upload with manual topic boundaries for long meetings; topics execute serially and retain independent labels.
3. Review the transcript and audition suggested speaker links and names before confirming them. Renaming a mixed label does not repair diarization.
4. Administrators maintain the enrollment library using clean single-speaker audio (10–180 seconds accepted; 20–60 recommended).
5. Open Meeting Minutes, choose a template and generate. The configured LLM receives transcript text and current speaker information. Keep source-linked and clean versions; each generation is stored in history.
6. Back up persistent data and monitor storage. See [installation](INSTALL.en.md), [models](MODELS.en.md) and [architecture](ARCHITECTURE.en.md).
