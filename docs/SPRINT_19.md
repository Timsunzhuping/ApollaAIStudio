# Sprint 19 执行单 — Voice & Speech I/O：对 Apolla 说话，听它回答

> 读者：**Codex / Claude Code**。逐任务从上往下执行；每个任务自带验收（DoD）、依赖、改动位置。
> 前置必读：[ARCHITECTURE.md](./ARCHITECTURE.md) §1（公理③升级即换挡 / 适配器矩阵）· [AGENTS.md](../AGENTS.md)（安全/不可信内容铁律）· `packages/adapters/media/openai`（S3 媒体适配器，fetch-based、env 门控的参照样板）· `apps/bff/src/object-store.ts`（`LocalObjectStore.put/read`，`/media/<key>` 已可服务二进制）· `apps/bff/src/server.ts`（`readRawBody`、`MAX_BODY_BYTES`、per-owner 限流、审计、S17 追踪 span）· Sprint 03（多模态媒体适配器）· Sprint 10（限流/审计/安全周界）· Sprint 17（追踪）。
> 目标产物（Sprint Demo）：**点麦克风 → 说一个研究问题 → 转写填入输入框 → 跑研究 → 把答案"读出来"。** 语音走可插拔 `SpeechProvider`（**Stub 离线 / OpenAI 生产**，ASR Whisper + TTS）；音频以 base64-JSON 传输、合成音频落对象存储经 `/media/<key>` 播放；转写文本是**不可信数据**（只填输入、绝不自动执行任何动作）；全程 owner-scoped + 限流 + 审计 + 追踪。

## 0. Sprint 范围与非目标

**主题**：十八个 Sprint 把 Apolla 做成了能力齐备、可上线、可扩展、可观测、能被生态调用的工作台——能力层一直在加平台/生态特性，**但还没有语音这个直接的端用户模态**。本 Sprint 用 harness 的招牌动作——**可换挡 capability provider**——再加一个模态：`SpeechProvider`（**ASR 转写 + TTS 合成**，Stub 离线默认 / OpenAI 生产 env 门控），并把它接进研究流程的两端：**说话提问**（语音→转写→填输入）与**听答案**（报告→合成→播放）。这是"加一个模态 = 写一个适配器 + 一个 UI 触点"的 harness 范式的又一次演示，且是面向用户的真实功能（前几个 Sprint 多为后端/平台，本 Sprint 换挡到用户体验）。

**做（本 Sprint 的闭环）**
- `SpeechProvider` 适配器：接口（`transcribe(audioBytes, {mime}) → {text}` / `synthesize(text, {voice?}) → {bytes, mime}`）+ `StubSpeechProvider`（离线确定性：转写按音频确定性产稳定文本、合成产确定性小音频 blob，无网络）+ `OpenAiSpeechProvider`（Whisper ASR + OpenAI TTS，fetch-based、`OPENAI_API_KEY` 门控、缺 key 回退 stub）+ `buildSpeechProvider()`。
- BFF 端点 + 存储：`POST /api/speech/transcribe`（base64 音频 + mime → `{text}`）；`POST /api/speech/synthesize`（text → 音频落 `LocalObjectStore` → `{uri}`，经 `/media/<key>` 播放）。owner-scoped、大小/时长/mime 限制、per-owner 限流、审计、追踪 span。
- Web 语音 UX：研究页**麦克风按钮**（`MediaRecorder` 录音 → base64 → `/transcribe` → 回填问题）；报告**朗读**（`/synthesize` → `<audio>` 播放）；端到端语音研究 demo（说 → 转写 → 研究 → 朗读）。
- 安全：**转写文本是不可信数据**（只回填输入框，由用户审阅后再提交；**绝不**据转写自动执行工具/高风险动作）；音频不入日志；大小/时长上限拒超额；provider 密钥从 env。
- 质量闸门：Stub 转写/合成确定性；OpenAI 适配器映射（mock fetch）；BFF 端点（owner-scoped/限制/审计）；Web 语音组件（mock `MediaRecorder`/fetch）；eval（语音往返）；全程 hermetic（Stub、无网络、无真实麦克风）。

**不做（留待 Sprint 20+）**
- 实时**流式 ASR**（分块边说边转）/ 唤醒词 / 连续对话语音助手 / 打断（barge-in）；说话人分离（diarization）；声纹/语音克隆。
- 多语种语音模型深度调优；音频编辑；电话/telephony 接入；**浏览器扩展的语音**（本 Sprint 仅 Web）。
- 把语音接进 Cowork/Agent 的自治回路（语音只驱动"提问/朗读"这两个用户手势，不进无人确认的执行链）。

**全程铁律**（违反即返工，见 [AGENTS.md](../AGENTS.md)）：`SpeechProvider` 可换挡（**Stub 离线默认 / OpenAI env 门控**，缺 `OPENAI_API_KEY` 回退 stub）；**默认/离线 hermetic**（Stub + mock `MediaRecorder`，**绝不连真实网络/麦克风**）；**转写文本是不可信数据**——只回填用户输入、由用户提交，**绝不**据转写自动触发工具/高风险/扣费/自治动作（沿用 untrusted-content 纪律）；每次调用 **owner-scoped + 限流 + 审计 + 追踪**；**大小/时长/mime 限制**（拒超额音频/文本）；provider 密钥从 env、**音频字节不入日志**；合成音频复用 `LocalObjectStore` + `/media` 服务（owner 不可猜的 key）；复用既有研究/对象存储/限流/审计/追踪（不旁路）；改动集中在 `contracts`、`harness-core`(speech)、`adapters/speech`、`apps/bff`、`apps/web`、`docs`、`evals`；每个能力配测试。

---

## 里程碑 A — SpeechProvider 适配器

### S19-T1 · SpeechProvider 接口 + StubSpeechProvider
- **做**：`contracts` 加 `Transcript`（text/durationMs?/lang?）。`harness-core/src/speech/*`：`SpeechProvider`（`transcribe` / `synthesize`）+ `StubSpeechProvider`（离线确定性：transcribe 由音频字节确定性产稳定文本（如长度/哈希派生），synthesize 产确定性小 WAV/PCM blob + mime）。
- **DoD**：Stub：同一音频 → 同一转写（确定性）；synthesize → 非空 bytes + 合理 mime；单测覆盖往返 + 确定性。
- **改动**：`contracts/src/speech.ts`、`harness-core/src/speech/*`。
- **依赖**：S3 媒体适配器范式。

### S19-T2 · OpenAI 语音适配器（env 门控）
- **做**：`adapters/speech/openai`（@apolla/speech-openai）：`OpenAiSpeechProvider`（ASR=Whisper `audio/transcriptions`、TTS=`audio/speech`，fetch-based、无 SDK、`OPENAI_API_KEY` 从 env）。`buildSpeechProvider()`：有 key → OpenAI，否则 Stub。
- **DoD**：缺 key → Stub；配 key → 构造成功；适配器单测用 mock fetch 验请求构造 + 响应映射（转写文本 / 音频字节+mime）。
- **依赖**：S19-T1。

---

## 里程碑 B — BFF 端点 + 存储

### S19-T3 · `POST /api/speech/transcribe`
- **做**：BFF `POST /api/speech/transcribe`（body `{audio: base64, mime}`）→ 解码 → owner-scoped + **大小上限**（拒超额）→ `speech.transcribe` → `{text}`。per-owner 限流、审计（tool=`speech.transcribe`）、追踪 span；**转写是不可信数据**（端点只返回文本，不据此触发任何动作）。
- **DoD**：返回转写文本；超大音频 → 413/拒；无鉴权 → 401；落审计 + 有 span；音频不入日志。
- **依赖**：S19-T1/T2、S10 限流/审计、S17 追踪。

### S19-T4 · `POST /api/speech/synthesize`
- **做**：BFF `POST /api/speech/synthesize`（body `{text, voice?}`）→ owner-scoped + **文本长度上限** → `speech.synthesize` → 落 `LocalObjectStore`（owner 不可猜 key）→ `{uri}`（`/media/<key>`）。限流、审计（tool=`speech.synthesize`）、追踪 span。
- **DoD**：返回可播放 uri（`/media/<key>` 200 + 音频 mime）；超长文本 → 拒；owner-scoped；落审计 + span。
- **依赖**：S19-T1/T2、对象存储、S10/S17。

---

## 里程碑 C — Web 语音 UX

### S19-T5 · 语音输入（麦克风 → 转写 → 回填）
- **做**：`apps/web` 研究页加**麦克风按钮**：`MediaRecorder` 录音 → 停止 → blob → base64 → `POST /api/speech/transcribe` → 把 `text` **回填问题输入框**（用户审阅后照常点"研究"提交）。录音/停止/转写中状态；权限/不支持降级。
- **DoD**：浏览器：录音 → 转写 → 文本进输入框（**不自动提交**）；组件测试 mock `MediaRecorder` + fetch；不支持麦克风时优雅降级。
- **依赖**：S19-T3、S9 前端。

### S19-T6 · 朗读（报告 → 合成 → 播放）+ 端到端 demo
- **做**：报告卡片加**朗读**按钮：`POST /api/speech/synthesize`（报告文本）→ `<audio src=uri>` 播放。串起端到端 demo：说问题 → 转写 → 研究 → 朗读答案。
- **DoD**：浏览器：点朗读 → 播放合成音频；组件测试覆盖合成→播放（mock fetch + audio）。
- **依赖**：S19-T4、S19-T5。

---

## 里程碑 D — 质量闸门

### S19-T7 · Eval/测试扩展
- **做**：Stub 转写/合成确定性 + 往返；OpenAI 适配器映射（mock fetch）；BFF 端点（owner-scoped、大小/长度限制、审计、无鉴权拒）；Web 语音组件（mock `MediaRecorder`/fetch/audio）；可加 1 项 eval（语音往返：合成→转写或 stub 确定性）。全程 hermetic（Stub、无网络/麦克风）。
- **DoD**：`pnpm test` + `pnpm test:web` + `pnpm e2e` 全绿且 hermetic；故意破坏（不限大小 / 转写自动执行 / 无鉴权 / 非 owner-scoped）任一即变红。
- **依赖**：S19-T1…T6。

### S19-T8 · 文档回写
- **做**：README（语音：`OPENAI_API_KEY`、Stub 默认 / OpenAI、麦克风权限、说→研究→朗读 demo、只读语义）；ARCHITECTURE（§ 适配器矩阵加 `SpeechProvider`；语音数据流 mic→transcribe→研究→synthesize→play；转写=不可信数据）；CLAUDE/AGENTS（语音铁律）；Sprint 19 DoD 勾选。
- **DoD**：新人照 README 在 Stub 默认与 OpenAI 两种模式跑通；文档准确。
- **依赖**：S19-T1…T7。

---

## 执行顺序与并行建议

```
S19-T1(SpeechProvider+Stub) ─ S19-T2(OpenAI) ─ S19-T3(transcribe) ─┬─ S19-T4(synthesize)
                                                                   ├─ S19-T5(语音输入)
                                                                   └─ S19-T6(朗读+demo)
                                                       全部收口 → S19-T7(测试) → S19-T8(Docs)
```
- **关键路径**：S19-T1（Provider + Stub）→ S19-T2（OpenAI）→ S19-T3（transcribe 端点）是地基；synthesize/输入/朗读在其上并行。
- **每完成一个任务**：跑该模块测试 + 既有回归 + `pnpm e2e`；一任务一 PR，CI 绿即合。
- **建议 PR 分组**：A(T1+T2) · B(T3+T4) · C(T5+T6) · D(T7+T8)。

## Sprint 19 Definition of Done（整体验收）
- [ ] `SpeechProvider`（Stub 离线 / OpenAI env 门控）+ `Transcript` 契约；transcribe + synthesize。
- [ ] `POST /api/speech/transcribe`（base64 音频→文本）+ `POST /api/speech/synthesize`（文本→音频/uri），owner-scoped + 限流 + 审计 + 追踪 + 大小/长度限制。
- [ ] Web 语音输入（mic→转写→回填，不自动提交）+ 报告朗读 + 端到端 demo。
- [ ] 转写=不可信数据（只回填、绝不自动执行）；音频不入日志；密钥从 env。
- [ ] `pnpm test` + `pnpm test:web` + `pnpm e2e` 全绿且 hermetic（Stub、无网络/麦克风）。
- [ ] README/架构文档更新。

## 风险与提示（给代理）
- **默认 Stub + hermetic**：无 `OPENAI_API_KEY` → StubSpeechProvider；测试用 Stub + mock `MediaRecorder`/fetch/audio，**绝不**连真网络或调真实麦克风/音频解码。
- **转写是不可信数据**：转写只回填输入框、由用户审阅提交；**绝不**据转写自动触发工具/研究/扣费/高风险动作（沿用 S4/S8 untrusted-content 纪律）。
- **大小/时长上限**：transcribe 限音频字节、synthesize 限文本长度；超额规范拒（防滥用 + 控成本）。base64 体积约 +33%，注意 `MAX_BODY_BYTES`，必要时给语音单独上限。
- **音频不落日志**：日志/审计/响应不含音频字节；合成音频用对象存储的不可猜 key、owner-scoped 服务。
- **provider 可换挡**：Stub 离线默认、OpenAI env 门控、缺 key 回退；与媒体/LLM 适配器同构。
- **浏览器兼容**：`MediaRecorder`/`getUserMedia` 不支持或拒权限时优雅降级（隐藏/禁用麦克风按钮 + 提示），不让页面崩。
- **诚实边界**：真实 Whisper/TTS 端到端是部署事项；本 Sprint 测 Stub 确定性 + OpenAI 适配器映射（mock fetch），PR 写明。
- **不确定/不可逆**（音频格式/mime、大小上限阈值、合成 voice 默认、是否计配额、转写语言默认）→ 选保守默认并在 PR 标注。
