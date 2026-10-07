# 更新日志

[English](CHANGELOG.md)

## v0.1.0-rc.4 — 2026-10-07

- 中英文展示名统一为 MeetingScribe，保留上游署名及兼容的技术标识。
- 新增麦克风实时转写：Qwen3-ASR-1.7B/vLLM、连续 Nemotron-3 说话人区分、VAD 与确认文字的字级对齐。
- 复用音频项目页面的文字编辑、角色修改、播放、笔记与纪要流程，音频和确认文字持续保存。
- 新增增量 Chunk Manager、保守的说话人确认、同人段落合并与行内临时文字；结束后可按保存配置重新处理完整录音。
- 修复麦克风录音未知时长与配置弹窗布局，同步已验证 GPU 源码基线、本地字体及账号/上传改进。
- 已验证 58 项前端测试、20 项实时 Python 测试、6 项原 Chunk Manager 测试、应用构建及 45 秒 GPU 分块回放。全新 GPU 安装、基于参考答案的分人准确率及多浏览器验收仍待完成，继续预发布。

## v0.1.0-rc.3 — 2026-10-06

- Correct the header logo to the exact JPG deployed on GPU1 after v18 verification. The prior rc.2 package still used the older PNG.
- Preserve the designer's original image bytes and metadata. The website, README and application package now reference the same JPG.
- 原样同步网站实际使用的新 JPG，保留隐藏设计及原文件元数据；修复 rc.2 漏同步 logo 的问题。

## v0.1.0-rc.2 — 2026-10-06

- 同步 GPU1 v18 网站、声波 logo 与会记P品牌。
- 中英文无刷新切换；快速转写恢复任务与音频语言选择。
- 持久化六小时过期及实际文件清单，重启后继续逐个文件清理；普通与快速转写统一排队。
- 纪要区分完成、部分结果和失败，禁用原始 HTML，修复表格与长段落。
- 增加上传上限、存储配额、登录限速、连接限制与超时。
- 添加就绪/存活检查、自动重启与备份恢复验证模板。
- 已有 GPU 部署验证；全新 GPU 安装与完整升级回退验收待完成，继续预发布。

## v0.1.0-rc.1

### 新增

- 默认英文界面及可记住选择的中英文切换；切换不翻译录音内容。
- Qwen音频语言独立设置：自动检测及与ForcedAligner共同支持的11种显式语言。
- API、服务、适配器和Python语言参数传递；语言验证、检测结果及英文分块空格回归测试。
- 中英文架构、模型、安装、验收及发布文档。
- 完整的topic → Nemotron → VAD/切片 → Qwen/对齐 → 人物确认 → 纪要流程说明。
- 运行文件安装助手、模型下载器及环境检查。
- 前端测试/构建、所选Go回归、Python桥接及容器构建CI。
- 标签触发的候选打包流程及SHA256校验。
- 部署、验收、发布与升级/回退说明。

### 调整

- 所有Compose入口构建会记P源码，不再拉取上游Scriberr镜像。
- Docker应用构建使用Node 22.12和Go 1.24.4；模型环境单独准备。
- 前端提供统一的 `npm test` 命令。
- 英文和中文README保留五个工程/发布入口，分别进入对应语言说明。

### 验证状态

既有A100环境检查通过。本地应用测试/构建见[验收记录](docs/VALIDATION.md)。全新GPU安装及容器GPU推理验收尚未完成，未宣称稳定发布。
