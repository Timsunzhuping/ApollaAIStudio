# Sprint 03 执行单 — 多模态成品：文生图 + 文生视频（Media Adapter + Seedance 2.0）

> 读者：**Codex / Claude Code**。逐任务从上往下执行；每个任务自带验收（DoD）、依赖、改动位置。
> 前置必读：[ARCHITECTURE.md](./ARCHITECTURE.md) §1/§3.5/§4/§9 · [AGENTS.md](../AGENTS.md) · [PRD.md](./PRD.md) §13 · [Sprint 01](./SPRINT_01.md)/[Sprint 02](./SPRINT_02.md)（已完成）。
> 目标产物（Sprint Demo）：**研究一个问题 → 生成带引用的报告 → 一键「生成封面图」与「生成讲解短视频（Seedance）」→ 媒体落入素材库、内嵌报告、可导出/分享 → 重启后仍在。** 全链路走 Harness Core，不旁路。

## 0. Sprint 范围与非目标

**主题**：把「一键成品」从文档/网页扩展到**图像与视频**，以**统一 Media Adapter**（与 §6.1 的 LLM 路由同构）灵活对接多家图像/视频模型（首批含 **Seedance 2.0**）。复用 Sprint 02 的持久化、配额、安全、技能底座。

**做（本 Sprint 的闭环）**
- 媒体适配层：`MediaAdapter` 接口 + 媒体逻辑别名（`image_*` / `video_*`）+ 路由配置 + 能力矩阵/成本预估。
- Provider：图像 provider（真实 fetch-based + 确定性 stub）、**Seedance 2.0** 视频 provider（异步 submit/poll + stub）。
- 异步媒体任务：`MediaTask`（submit→processing→ready/failed），SSE 进度 + 预估；对象存储抽象（本地 FS + S3 兼容接口）转存产物。
- 交付：媒体落 Artifact / 素材库，报告内嵌图像，可预览/下载/分享。
- 安全与成本：生成前后内容审核（NSFW/版权/肖像）接 Safety；MediaPricingBook 计费写 UsageLedger；视频高成本二次确认 + 配额。
- 复用：声明式媒体 Skill/模板；研究→媒体串联（一键配图/封面/讲解短视频）。
- 质量闸门：MediaAdapter provider contract、成本预估、审核拦截、视频异步失败回退；文档 + Demo 升级。

**不做（留待 Sprint 04+）**
- 翻译 / Writer / AI Sheets / Meeting Notes / AI Developer 等文本产品面（Sprint 04 候选，多为声明式 Skill）。
- 真实 MCP 连接（`connectMCP` 仍 stub）、浏览器扩展 / Browser Actions、Cowork、生产级 Next.js 前端、专业剪辑/调色工作站（超出工作台定位）。

**全程铁律**（违反即返工，见 [AGENTS.md](../AGENTS.md)）：**禁止硬编码媒体模型名**（只用 `image_*`/`video_*` 别名，映射在路由配置）；外部内容走数据通道；视频一律**异步任务对象 + 成本预估 + 内容审核**；每个能力配 eval；改动集中在 `harness-core`/`adapters`/`config`/`evals`/`apps`；不确定/不可逆动作先问。
**新增媒体铁律**：媒体生成是高成本且有合规风险的能力——预估在前、审核在前后、配额拦截、产物按 owner 隔离可删。

---

## 里程碑 A — 媒体地基（适配层与 Provider）

### S3-T1 · Media Adapter 接口 + 别名 + 路由 + 契约
- **做**：`packages/harness-core/src/media/*`。定义 `MediaAdapter`：`submit(job)`、`poll(jobId)`/回调、`fetchResult(jobId)`、`capabilities()`、`estimateCost(params)`、`mapError()`（对齐 [PRD §13.2](./PRD.md)）。媒体逻辑别名 `image_fast`/`image_premium`/`video_standard`/`video_premium` + 路由配置（`packages/config/media-routes.json`，值为占位 provider/model id）。contracts 加 `MediaJob`、`MediaAsset`、`MediaCaps`、`MediaTask`。`MediaRepository`（内存 + 后续 PG）。
- **DoD**：业务层只用别名；非法媒体路由启动即报错；`MediaRouter`（按别名选 provider）+ 一个 stub provider 能走通 submit→ready 并返回 `MediaAsset`。
- **改动**：`harness-core/src/media/*`、`contracts/src/media.ts`、`config/media-routes.json`。
- **依赖**：无（基于 Sprint 01/02 模式）。

### S3-T2 · 图像 Provider（文生图 / 图生图）
- **做**：`packages/adapters/media/image-*`。一个真实 fetch-based 图像 provider（env-keyed，如 OpenAI Images 或可配置端点）+ **确定性 stub**（离线/CI/eval：返回可见占位图，如按 prompt 渲染的 SVG data-URI/文件）。实现统一 `MediaAdapter`。
- **DoD**：`image_premium` 别名经路由 → 图像 provider → 返回 `MediaAsset`（含 mime/尺寸/uri）；无 key 时自动用 stub，产物在 Demo 可见。
- **依赖**：S3-T1。

### S3-T3 · Seedance 2.0 视频 Provider（异步）
- **做**：`packages/adapters/media/seedance`。`SeedanceVideoAdapter` 实现统一 `MediaAdapter`：文生视频/图生视频/参考图/运镜/宽高比/时长/分辨率/帧率，按其**异步 submit + poll/webhook** 对接；凭证/端点走 env + 密钥管理。`capabilities()`/`estimateCost()` 声明能力矩阵与计费参数。**确定性 stub** 模拟异步生命周期（processing→ready，返回占位视频/海报）。
- **DoD**：`video_premium` 别名 → Seedance 适配（有 key）或 stub（无 key）；异步任务从 submit 走到 ready，产物为 `MediaAsset`；区域可达性/合规由 config 开关控制（[PRD §14/§16 开放问题](./PRD.md)）。
- **依赖**：S3-T1。

---

## 里程碑 B — 异步编排与交付

### S3-T4 · 媒体任务编排 + 对象存储
- **做**：`MediaOrchestrator.run(job)` 返回事件流（`submit`→`progress`→`asset`/`error`），状态机 `submitted→processing→ready|failed`，可回放、可计费、按 owner 隔离持久化（`MediaTask`）。对象存储抽象 `ObjectStore`（本地 FS 实现 + S3 兼容接口），把 provider 产物**转存自有存储**并返回稳定 uri。
- **DoD**：提交一个视频任务 → 先发预估（耗时/成本）→ 流式进度 → ready 后产物转存、可下载；失败走 `failed` 并报错（沿用 Router/Adapter 失败语义）。
- **依赖**：S3-T1、S3-T2/T3。

### S3-T5 · 媒体进 Artifact / Export / 素材库
- **做**：媒体产物落 `Artifact`（type=image/video）与项目素材库（复用 Sprint 02 Projects）。报告导出（Markdown/HTML）**内嵌图像**（`![](uri)`/`<img>`）；视频以海报 + 链接呈现。分享链接复用导出端点。
- **DoD**：同一研究任务可「生成封面图」→ 图像入素材库 + 内嵌 HTML 报告；导出 `.md`/`.html` 含图像；媒体产物可下载/分享，按 owner 隔离。
- **依赖**：S3-T4。

---

## 里程碑 C — 安全与成本

### S3-T6 · 内容审核（生成前 + 生成后）
- **做**：接 Safety & Policy。**生成前**审 prompt（禁用类目/名人肖像/版权关键词）→ 拒绝并提示；**生成后**审产物（占位/真实审核 provider 抽象，stub 用规则）→ 标记/拦截。审核结果进 `MediaTask`。
- **DoD**：构造违规 prompt → 生成前被拒（不调用 provider）；生成后审核可标记可疑产物；审核为可插拔接口（stub 离线可跑）。基线注入用例：媒体 prompt 里夹带"忽略指令"不影响审核判定。
- **依赖**：S3-T4。

### S3-T7 · 媒体成本与配额
- **做**：`MediaPricingBook`（按别名/参数计价）+ 媒体调用写 `UsageLedger`（kind=media）。视频等高成本任务：提交前返回**成本预估**并要求二次确认；媒体配额并入 Sprint 02 `Quota`（或独立媒体额度）。Demo 任务级成本提示。
- **DoD**：提交视频前显示预估成本并需确认；生成后实际成本写 UsageLedger 且 `report(taskId)` 含媒体分项；超额返回 402 提示。
- **依赖**：S3-T4。

---

## 里程碑 D — 复用与串联

### S3-T8 · 媒体 Skills / 模板
- **做**：声明式媒体 Skill（`config/skills/*`，如 `cover-image`、`explainer-video`），走 Media Adapter（新 executor：`media`）。可把一次媒体生成参数存为可复用模板（闭环，复用 Sprint 02 Skill 持久化）。
- **DoD**：`match('生成封面')` 命中 `cover-image`；`run` 经 Media Adapter 产出图像；新增声明式媒体 Skill 无需改业务代码即可被 match/run；可存为用户媒体 Skill 并复跑。
- **依赖**：S3-T1、Sprint 02 Skill Runtime。

### S3-T9 · 研究 → 媒体串联（用户流一收尾）
- **做**：研究成稿后在工作区提供「一键配图 / 生成封面 / 生成讲解短视频」，以报告摘要为 prompt 驱动 Media Adapter；产物回填报告与素材库。
- **DoD**：完成一次研究 → 一键生成封面图与讲解短视频 → 内嵌/附于报告 → 导出含媒体。Demo 即此流程。
- **依赖**：S3-T5、S3-T8。

---

## 里程碑 E — 质量闸门

### S3-T10 · Eval 扩展（媒体）
- **做**：扩 `evals/`：①MediaAdapter **provider contract**（换/加 provider 不破坏调用方）②成本预估准确性（估算 vs 计费）③内容审核拦截用例（违规 prompt 必拒）④视频异步失败回退（provider 失败 → failed 且无脏数据）⑤能力矩阵一致性。CI 用 stub（确定性，离线）。
- **DoD**：`pnpm eval` 覆盖以上；CI 必过；故意破坏（审核放行违规 / 成本预估漂移 / 异步失败不回退）任一即变红。
- **依赖**：S3-T1…T7。

### S3-T11 · 文档回写 + Demo 升级
- **做**：更新 README/ARCHITECTURE/CLAUDE/AGENTS（媒体别名、`MEDIA_*`/Seedance env、对象存储 env、命令）。Demo 升级为完整 Sprint 03 流程（研究 → 报告 → 封面图 → 讲解短视频 → 导出/分享，Postgres 持久化媒体）。
- **DoD**：新人/新代理按 README 一条命令起本地；命令与实际一致；Demo 端到端走通，离线 stub 可演示。
- **依赖**：S3-T1…T10。

---

## 执行顺序与并行建议

```
S3-T1(Media Adapter) ──┬─ S3-T2(图像) ─┐
                       └─ S3-T3(Seedance 视频) ─┤
                                                 ├─ S3-T4(异步编排+存储) ─┬─ S3-T5(Artifact/素材)
                                                 │                        ├─ S3-T6(审核)
                                                 │                        └─ S3-T7(成本/配额)
S3-T8(媒体 Skills) ── 依赖 T1 + Sprint02 Skill   │
                                  全部收口 → S3-T9(研究→媒体) → S3-T10(Eval) → S3-T11(Docs/Demo)
```
- **关键路径**：S3-T1（Media Adapter）是地基，解锁 provider 与编排；S3-T4（异步编排）是交付收口点。
- **可并行**：T1 后图像线（T2）、视频线（T3）并行；T4 后审核（T6）、成本（T7）、交付（T5）并行；T8 可早开。
- **每完成一个任务**：跑该模块单测 + 相关 eval；一任务一 PR，CI 绿即合；提交说明写清「动了哪个注册点 + 加了哪个 eval」。

## Sprint 03 Definition of Done（整体验收）
- [ ] 统一 Media Adapter：业务层只用 `image_*`/`video_*` 别名；换 provider 不改调用方（provider contract 绿）。
- [ ] 文生图：研究后一键生成封面图，入素材库、内嵌 HTML 报告、可导出。
- [ ] 文生视频（Seedance）：异步任务从 submit→ready，先预估后生成，产物可下载；无 key 时 stub 可演示。
- [ ] 对象存储：产物转存自有存储并返回稳定 uri；按 owner 隔离、可删。
- [ ] 内容审核：违规 prompt 生成前被拒；产物可标记；审核可插拔。
- [ ] 成本/配额：视频前显示预估并二次确认；媒体成本写 UsageLedger 分项；超额 402。
- [ ] 媒体 Skill：声明式媒体 Skill 可 match/run；可存为模板复跑。
- [ ] `pnpm eval` 含媒体 provider contract / 成本预估 / 审核拦截 / 异步失败回退；CI 全门禁绿。
- [ ] 数据持久化：媒体任务/产物重启后仍在（Postgres + 对象存储）。
- [ ] README/命令/架构文档一致更新；Demo 端到端走通（离线 stub 可演示）。

## 风险与提示（给代理）
- **Seedance 区域可达性/合规**：env 开关 + config 控制；无 key/不可达时**自动 stub**，保证离线/CI/Demo 可跑（沿用搜索 stub 模式）。CI 绝不真实调用媒体 provider。
- **异步是默认**：视频分钟级，别做成同步阻塞；stub 也要模拟 `processing→ready` 生命周期，证明编排正确。
- **对象存储**：先做本地 FS 实现 + S3 兼容接口；不要把 provider 临时 uri 直接暴露（会过期）——一律转存。
- **成本是高风险**：预估在前、二次确认、配额拦截、UsageLedger 分项——媒体毛利失控是 Agent 产品常见死法。
- **审核别只做事后**：生成前拒比生成后删更省钱省风险；审核接口可插拔，stub 用规则，留真实 provider 位。
- **不要扩范围**：文本产品面（翻译/Writer/Sheets/Meeting）与 MCP/浏览器执行一律 Sprint 04+；本 Sprint 只把「多模态成品」打穿。
- **不确定/不可逆**（选图像 provider、对象存储后端、Seedance 端点形态）→ 选合理默认并在 PR 标注；破坏性存储操作先确认。
