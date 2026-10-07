# GPU source baseline / GPU 源码基线

Date: 2026-10-06. Local repository preparation; no server deployment performed.

## Verified relationship

- GitHub main history was recovered through the existing authorized GitHub
  connection. All 14 commits, their trees and blob contents were verified against
  Git object hashes; the baseline HEAD was `4d42925a13cbe7c0a786f9c41dc83afb2d3d7ec8`.
- The existing GPU application checksum matches the archived local page-load
  performance build: `f65759ddc359b8c3e81b5128358b1f68c3e8890cee26c23cd893cbb0d59f14c8`.
- The local application source was imported from the source snapshot associated
  with that build. Active Qwen, Chunk Manager, FunASR, Nemotron and native topic
  helper scripts were checked separately against the GPU runtime.
- Original source, binary and application-source checksums are preserved under
  `.local/baseline/`. Private machine paths and inventory belong there.
- Newer GitHub documentation/release tooling is retained instead of overwritten
  by older deployment-snapshot documentation.

## Local-only changes relative to the running build

- English display name: MeetingScribe; Chinese display name: 会记P.
- Frontend output and Go embed directory normalized to `dist`, retaining the
  running build's compression, cache headers and local fonts.
- Workspace rules, local-only boundaries and publishing-path checks added.

These changes mean the newly built binary will differ from the running server's
binary. The server still runs the original verified build. This baseline is not a
claim of a byte-for-byte rebuild or identical laptop/GPU runtime environments.

## Git access

Ordinary HTTPS/SSH Git authentication is not configured successfully on this
laptop. The local repository retains the remote main history and origin URL,
but future normal fetch/push requires configuring Git authentication. Do not
invent new history or force-push to work around authentication.

## Local validation results

- Frontend: 39 tests passed and TypeScript/Vite build passed using Node 24.
- Runtime scripts: 26 unit tests passed using Python 3.11 with NumPy.
- Go: model/middleware tests, lightweight-list ownership/detail regression and
  selected API tests for multiuser access, account quotas, uploads, topic inputs
  and Qwen parameters passed. Broad tests with automatic directory cleanup were
  not run under the project's deletion restriction.
- Linux amd64 application build passed with Go 1.24.4. Build output is local only.
- Application source manifest matches the GPU snapshot except six documented
  display-name and build-directory changes. All seven runtime script hashes match.
- Documentation links, Git object integrity and publishing path checks passed.
- GPU health remained ready with database, models and storage checks true; the
  running program checksum and process were unchanged. No real GPU transcription
  was rerun because runtime code and server configuration were unchanged.

## MeetingScribe branding deployment — 2026-10-06

The earlier local-only branding state above is historical. Following explicit
user authorization, MeetingScribe is now the display name in both English and
Chinese, including the header, page title, icon accessibility text, registration,
settings copy and PWA manifest. The existing GPU startup script was preserved and
only its application-binary binding was changed. Existing runtime identifiers,
model environments and data locations remain compatible.

- Source base: `bbe54f07fe59419bfe9aa10f2aa9da8630ec8fc3` plus reviewed local branding changes.
- Deployed Linux amd64 program SHA256: `ea9526c74e832f9dbbff0837fb71f6970fab62af0e25b68913c82269fd25cfc0`.
- Source-manifest SHA256: `640fb31bc0699cc641f1dbc71207c02db8d2005e13c29ec3df9eaab357c809d2`.
- All seven runtime script hashes were rechecked and match the local source.
- Frontend: 39 tests passed; TypeScript/Vite production build and Linux build passed.
- Pre-switch active transcription, summary and model-process counts were zero.
- Post-switch health was ready, with database, storage and models all true.
- Browser verification passed in both interface languages; the original Chinese preference was restored.
- The previous program and actual launcher were retained for rollback. Private
  deployment paths, startup-script checksums and logs are under `.local/validation/`.
- No real GPU transcription was rerun for this branding change. The processing
  scripts were unchanged. No Git commit or source push was performed.

## Microphone recording duration repair — 2026-10-06

The player recovers missing WebM duration using an isolated silent media probe.
Finite metadata continues to use native streaming. Unknown values render as
`--:--`; duration updates and cancelled probes are handled explicitly. Existing
recordings are supported without replacing their audio or transcription.

- Source base: `bbe54f07fe59419bfe9aa10f2aa9da8630ec8fc3` plus reviewed branding and duration changes.
- Deployed program SHA256: `dc70196cbded6d23eaa8b64ec0c6c69df59ba5d6165b1693d7854dc909b7d883`.
- Source-manifest SHA256: `c9d3ff4b37e966590976b7091c7362b98f9de51446d0dd9d7c194071af78626e`.
- Frontend: 43 tests passed; TypeScript/Vite and Linux amd64 builds passed.
- A real microphone recording showed a finite total duration; scrubber seeking,
  playback progression, natural completion, replay and pause were verified in Chrome.
- Pre-switch active transcription, summary and model-process counts were zero.
  Post-switch health was ready; all seven runtime script hashes still matched.
- Actual launcher and previous program were retained for rollback; private
  deployment and browser evidence is under `.local/validation/` and `.local/screenshots/`.
- No Git commit or source push was performed. Long recordings and other browsers
  were not covered by this verification.

## Realtime transcription deployment — 2026-10-06

A separate realtime option now streams microphone PCM to Qwen3-ASR-1.7B through
vLLM, with continuous Nemotron-3 speaker labels and ForcedAligner final word
alignment. Recording/upload options remain available. GPU admission allows one
live session and prevents overlap with ordinary transcription work.

- Source base: `bbe54f07fe59419bfe9aa10f2aa9da8630ec8fc3` plus reviewed local changes.
- Deployed program SHA256: `bc5e4c428416f50b77c230408a36de8f09eba11f250c6c7c538430a68f36ccbb`.
- Source-manifest SHA256: `3e03eb01acd1f0bb9adbf44b92ad45646ce5d2bc7b773c7f878bac2c0426cb6c`.
- Actual launcher SHA256: `ec402056a5a53cfdeb535481575c51c0ef2bc67b894f68d18952ba8585d66c33`.
- Realtime model launcher SHA256: `fb46d2ddeb9fa2259c8b8930d82c25ce993988bd4a7dec170f569d78f63520c6`.
- Frontend: 48 tests passed; TypeScript/Vite and Linux amd64 builds passed.
  Ten Python session/speaker tests and four Go realtime tests with race detection passed.
- Existing microphone and public multi-speaker fixtures completed on the GPU.
  These were chunk replays, not browser latency or speaker-accuracy benchmarks.
- Pre-switch active transcription, summary and model-process counts were zero.
  Application health is ready; both services are active; realtime models report available.
- Authenticated Chrome shows the realtime dialog with its start button enabled.
  New live microphone capture remains for user acceptance testing.
- All seven existing offline runtime hashes matched. Database and model data stayed in place.
- Previous application and actual launcher are retained under the deployment's
  `rollback/` directory. Private paths and complete evidence are in
  `.local/validation/realtime-deployment.json` and `.local/screenshots/`.
- No Git commit or source push was performed. Live sessions currently allow
  30 minutes of audio; short speaker evidence can remain unconfirmed.

## Menu and profile-dialog layout repair — 2026-10-06

The realtime menu item now uses the same icon container, typography and spacing
as other entries. Profile selection displays only the profile name; its description
appears below. Dialog columns are constrained to prevent long content from pushing
footer actions outside the visible panel. The profile-dialog title is translated.

- Deployed program SHA256: `963731df6ed768733ddfdf7776b5e4c7e1dc9d335c7252d6f2b5f415c490ed0c`.
- Source-manifest SHA256: `214e83417ffc29dc3db93ebf622963556393405f4939097e073b470583efb2b2`.
- Actual launcher SHA256: `a412c2bb4c8874897bbe98c4d6e64bfc8ec4e3760aa3452320c92b2b465a3e5e`.
- Frontend: 48 tests passed; TypeScript/Vite and Linux amd64 builds passed.
- Pre-switch ordinary task and model-process counts were zero. Health remained ready;
  both application and realtime model services are active, and realtime models are available.
- Chrome verified menu alignment and the translated profile dialog. The start button
  is enabled and lies completely inside the dialog. No transcription was launched
  during this layout verification.
- Previous program and actual launcher are retained in this deployment's `rollback/`.
  Private deployment records and screenshots are in `.local/validation/` and
  `.local/screenshots/`. No Git commit or source push was performed.

## Independent realtime page deployment — 2026-10-06

The realtime menu opens `/live`, with input-device selection, actual microphone
name, input meter, captured/processed duration, pending chunks, speaker count,
and transcript rows with time ranges and provisional/confirmed speaker labels.

- Deployed program SHA256: `e611bdc2a065590f6b3b5690d3a6c6bf6e5861b29bc4033b4dca7c76799496f3`.
- Source-manifest SHA256: `a8726335a93b87e61f5ce017b96c56099be6a7546153c7ad62b4c0593a2aaa21`.
- Actual launcher SHA256: `e7b34a2a891db59d9d0395a91a9c33bdd5500b307a5fc30992ea2d727b61e9d4`.
- Frontend: 48 tests, TypeScript/Vite and Linux amd64 build passed.
- Health is ready; both services active; realtime models available. Existing
  offline runtime hashes match, and no ordinary jobs were active before switching.
- Chrome verified menu navigation, device selection and the complete page layout.
  A short built-in microphone test showed nonzero input and matched capture and
  processing counters, with no queued blocks. It recognized no speech and was
  stopped without saving a project; this does not establish live speech accuracy.
- A voiced 16.5-second fixture separately returned 61 characters, four segments,
  50 word timestamps and one speaker label. Replay timing is not browser latency.
- Previous program and actual launcher remain in the deployment's `rollback/`;
  private records and screenshot evidence are under `.local/validation/` and
  `.local/screenshots/`. No Git commit or source push was performed.

## Realtime paragraph display deployment — 2026-10-06

Consecutive short segments by the same speaker now form readable paragraphs,
using the uploaded-transcript paragraph length rules. Speaker changes, pauses
longer than three seconds and long paragraphs start new rows. Time ranges and
speaker labels occupy the side column, with provisional text inline at the end.
Full response replacement regroups revised labels without duplicating draft text.
Original stored segments and word timestamps remain unchanged.

- Deployed program SHA256: `d66ab25ad7cf0b8867411828e5295a054666f6626a8b9564e3c375fcd919d232`.
- Source-manifest SHA256: `1d5aa9d6f34c7b5a39adb50c7bc8f8c93953a08a664ab3782fbaa88b24894f5e`.
- Actual launcher SHA256: `ff0462a4024f195b1c87b8d18d2b1bf1f3241c965fd8e3fa8edb2ea056f1ed12`.
- Frontend: 52 tests, TypeScript/Vite and Linux amd64 build passed. Tests cover
  grouping, speaker changes, pauses, label revisions and draft/final replacement.
- A browser preview with synthetic content verified paragraph wrapping and inline
  draft styling. The deployed realtime asset matches that reviewed build by SHA256.
- Application health is ready; both services active; realtime models available.
  Pre-switch ordinary task counts were zero. The user's browser recording was stopped.
- A separate Chrome tab verified the new page and resource version, preserving
  unsaved recording state in the original tab. No new microphone session was started.
- Previous program and actual launcher remain in this deployment's `rollback/`;
  complete private evidence is under `.local/validation/` and `.local/screenshots/`.
  No Git commit or source push was performed.


## Asynchronous realtime processing deployment — 2026-10-07

PCM receipt now queues ordered inference without waiting for model processing.
Confirmed text is retained before asynchronous word alignment; CPU VAD and GPU
alignment run in separate workers. Text, timestamp and speaker states are shown
separately, and speaker changes no longer force an ASR context reset. Finishing
keeps GPU admission until queued inference and final alignment complete.

- Source base: `01e99b7d6bb50cbcebad1bf181ef10d7ab670c49` plus reviewed working-tree changes.
- Program SHA256: `69bda91d2f47bb4ce9e49174c904ae75e049f0eba4bbc94f158cddec8f4ef92d`.
- Source-manifest SHA256: `f8164bd2966f08d66f782fa7991c6371c747854b94061ac6e09b7fca03a78825`.
- Thirty realtime Python tests, six original chunk-planner tests, 63 frontend
  tests, TypeScript checks, API/admission race checks and production builds passed.
- A 45-second public fixture replayed at recording speed completed on the GPU;
  maximum observed inference backlog was one second and final drain was about
  0.26 seconds. This is not a browser microphone or long-meeting accuracy benchmark.
- Application health is ready and realtime models are available. The frontend
  asset served through localhost matches the reviewed build by SHA256.
- Seven existing offline runtime checksums matched. The previous program, actual
  application launcher, model launcher/unit and realtime source are retained for
  rollback. Database, recordings and model files were not replaced.
- Private verification and rollback details are in `.local/validation/`. No Git
  commit or source push was performed.
# 实时结束兼容修复部署（2026-10-07）

基于 `01e99b7d6bb50cbcebad1bf181ef10d7ab670c49` 的核对后工作树构建，修复旧页面结束与自动清理的兼容问题，加入页面版本提示及结束草稿隐藏。
程序 SHA256：`8ab5866cb15bce4a500491d8b928b15e696c10f22199731e6ce5c2f60f2407d0`；源码清单 SHA256：`c0654725e24eef4b1910509e97329280119c622d075565353265fad53cd61dcb`。
部署前确认没有活动任务，保留实际启动器和旧程序回退；健康检查、版本标识及前端资源校验通过。实际启动器 SHA256：`72d544de7851123034c2a459e2c845f79190c3efc000a4b4182f15668202efe6`。
本次只更新应用及前端，模型服务继续运行；数据库、录音和模型权重保留。完整部署验证及回退位置记录在私人验证目录的 `finish-fix-deployment.json`。

## 字词局部说话人判定部署（2026-10-07）

基于 `01e99b7d6bb50cbcebad1bf181ef10d7ab670c49` 的核对后实时 Python 工作树更新，修正短区间弱边缘否决高分字词及候选列表跨时间污染的问题。
说话人源码 SHA256：`1f48824ce79660e2e78a9b4d2eede8b81d839aaee7e6a3e5927c806b25415eff`；部署源码清单 SHA256：`88aeec5ee57727bdad056ecf261e7fd771d4f4e7c21a25c50312eaa7394ba3d4`。
应用程序继续使用 SHA256 `8ab5866cb15bce4a500491d8b928b15e696c10f22199731e6ce5c2f60f2407d0`；模型启动器 SHA256：`6c5686d0710971f99fca938eac55f7d62a99745fb0cad0b2f96f0f01829f887c`。
部署前确认无活动任务并保留实际配置、源码及程序回退。生产容器说话人测试和45秒公开音频回放通过，模型就绪与应用健康检查通过。历史结果及录音保留，修复对新实时会话生效；上传链路保持原版。完整部署记录及回退位置在私人验证目录的 `speaker-local-deployment.json`。

## 统一阅读展示与跨片段衔接部署（2026-10-07）

上传与实时转写共用正文分段、空说话人回退和名称提示；空标签可跨 ASR 片段沿用前一位显示说话人，保留明确换人和既有段落长度/停顿规则。页面不显示身份待确认、暂定或待核对提示；原始标签、字词索引与时间戳保留。

最终程序 SHA256：`51368e2f10a9fabb661fea08018566af2911bdbdb0581b9116132f32e2915e2a`；实际启动器 SHA256：`c00945fc34cf155710353c770e0d0a991f24eeeb9ee9be8f49c5f532bbcdaadd`。部署前无活动任务，旧程序与实际启动器已保留用于回退。109 个页面资源、版本标识与应用健康检查通过，模型及七个离线脚本校验保持一致。

62 项前端测试、35 项实时 Python 测试、6 项原切块测试、实时 API/队列竞态检查和生产构建通过。本地浏览器验收确认字词索引唯一、时间戳不变，上传与实时展示一致。完整部署记录及回退位置保留在私人验证目录的 `cross-segment-display-deployment.json`；私人录音、截图、数据库及验证材料不纳入 Git。
