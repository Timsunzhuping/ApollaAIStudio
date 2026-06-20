# Sprint 02 执行单 — 从 Demo 到「持久化 · 个人化 · 可复用」工作台

> 读者：**Codex / Claude Code**。逐任务从上往下执行；每个任务自带验收（DoD）、依赖、改动位置。
> 前置必读：[ARCHITECTURE.md](./ARCHITECTURE.md) §1/§3/§4/§9 · [AGENTS.md](../AGENTS.md) · [PRD.md](./PRD.md) §6.3/§6.4/§12.A/§12.B · [Sprint 01](./SPRINT_01.md)（已完成）。
> 目标产物（Sprint Demo）：**登录 → 在一个项目里发起研究 → 系统记住你的写作偏好 → 把这次研究存成一个 Skill → 在新问题上一键复跑该 Skill → 重启服务后数据仍在。** 全链路走 Harness Core，不旁路。

## 0. Sprint 范围与非目标

**主题**：把 Sprint 01 的可演示骨架，变成一个**持久化、多用户、有记忆、技能可复用**的真实工作台。补齐 Sprint 01 刻意留下的债（内存持久化、单用户 stub、一次性 json 综合），并落地 PRD 的 v1/P1 个人化能力。

**做（本 Sprint 的闭环）**
- 持久化：Postgres + 迁移 + `TaskRepository` 的 Postgres 实现（保留接口，内存实现仍用于单测）。
- 账号与项目：最小可用 Auth（真实 `ownerId`）+ Projects（项目空间、上下文继承、素材库）。
- 个人化：Memory（会话 FTS 检索 + LLM 摘要 + 结构化用户模型 + memory nudging），并注入研究流。
- 技能与闭环：Skill Runtime（声明式加载/触发/执行）+ 闭环自动写 Skill + Custom Skills 复跑（用户流三）。
- 平台增强：流式综合（真实 token 流）、Capability Probes + FeatureGate 运行时、配额与计费档。
- 质量闸门：Eval 扩展（记忆召回、Skill 质量、多 golden）+ Postgres 集成测试 + Demo 升级。

**不做（留待 Sprint 03+）**
- 多媒体生成（文生图/视频、Seedance、Media Adapter）——独立大主题，Sprint 03 候选。
- 翻译 / Writer / AI Sheets / Meeting Notes / AI Developer 等新产品面。
- 浏览器扩展与 Browser Actions、MCP 真实连接（`connectMCP` 仍为 stub）、Cowork、企业治理、生产级 Next.js 前端。

**全程铁律**（违反即返工，见 [AGENTS.md](../AGENTS.md)）：禁止硬编码模型名 / 内联 Prompt；外部内容走数据通道；每个能力配 eval；改动集中在 `harness-core`/`adapters`/`config`/`evals`/`apps`；可执行工具进沙箱；不确定/不可逆动作先问。
**新增数据铁律**：所有用户数据按 `ownerId` 隔离；记忆/项目/任务可删除、可导出（PRD §8）。

---

## 里程碑 A — 持久化与账号（地基硬化）

### S2-T1 · Postgres 持久化（替换内存 Repository）
- **做**：新增 `packages/adapters/db-postgres`（或 `packages/persistence`）实现 `TaskRepository`（Sprint 01 的接口）。用 Postgres + 一个轻量查询层（`postgres`/`pg` + 手写 SQL，或 `drizzle`）。提供迁移（`migrations/*.sql`）。表：`tasks`、`steps`、`sources`、`citations`、`artifacts`、`usage_records`（或 Task 整体 JSONB + 关键列）。`docker-compose.yml` 起本地 PG。
- **接口**：实现既有 `TaskRepository`（`create/get/save/list`），**不改调用方**。内存实现保留，单测继续用它。
- **DoD**：`PostgresTaskRepository` 通过与 `InMemoryTaskRepository` 相同的一套契约测试（共享 repo contract suite）；集成测试连真实 PG（CI 用 service container）建任务→保存→读取→`list(ownerId)` 正确；按 `ownerId` 隔离。
- **改动**：`packages/adapters/db-postgres/*`、`infra/docker-compose.yml`、CI 加 postgres service。
- **依赖**：无（基于 Sprint 01 接口）。

### S2-T2 · 最小 Auth 与用户身份
- **做**：替换 `apps/bff` 的单用户 stub。最小可用：email + 会话 cookie（或 magic-link / API token，二选一，写明取舍）。`users` 表。中间件解析当前 `ownerId`，注入请求上下文。仅本人可读写本人数据。
- **DoD**：未登录访问 `/api/tasks*` 返回 401；登录后任务/项目归属当前用户；两个用户数据互不可见（集成测试）。
- **改动**：`apps/bff/src/auth/*`、`server.ts` 中间件、`db-postgres` users。
- **依赖**：S2-T1。

### S2-T3 · Projects（项目空间）
- **做**：Project 数据模型（contracts 加 `Project`）。项目内：上下文继承（项目背景/说明注入研究流）、素材库（上传/已抓取内容归档复用）。`POST /api/projects`、`GET /api/projects`、任务可挂 `projectId`。
- **DoD**：在项目内发起的研究，其 plan/synthesize 注入项目背景（经数据通道）；项目素材可被新任务检索复用；项目与任务按 owner 隔离。
- **改动**：`packages/contracts/src/project.ts`、`harness-core`（项目上下文注入点）、`db-postgres`、`apps/bff` 路由 + UI 项目切换。
- **依赖**：S2-T1、S2-T2。

---

## 里程碑 B — 个人化与记忆

### S2-T4 · Memory 架构（PRD §12.B）
- **做**：`packages/harness-core/src/memory/*`。三层：
  1. **会话级检索**：Postgres 全文检索（FTS / `tsvector`）历史会话 + LLM 摘要，跨会话回忆。
  2. **结构化用户模型**（USER 档案）：写作风格、领域偏好、常用格式、项目习惯——可编辑、用户可见。
  3. **Memory nudging**：按相关性注入（非全量），与缓存/成本一致。
  接口：`Memory.recall(query, ownerId): MemoryItem[]`、`Memory.updateUserModel(...)`、`Memory.note(...)`。`memory_items` 表 + FTS 索引。
- **DoD**：写入若干会话后 `recall` 能召回相关条目（FTS 命中 + 摘要）；用户模型可读/可编辑/可删除/可关闭（数据铁律）。
- **改动**：`harness-core/src/memory/*`、`db-postgres`、contracts `MemoryItem`/`UserModel`。
- **依赖**：S2-T1。

### S2-T5 · 记忆注入研究流（个性化生效）
- **做**：Orchestrator 在 plan/synthesize 前 `Memory.recall` + 取用户模型，经**数据通道**注入（风格/偏好作为 system 约束，召回内容作为 data）。任务结束 `Memory.note` 写回要点。
- **DoD**：同一用户设定「偏好要点式、中文输出」后，新研究的成稿风格随之变化（eval：带 user-model 时输出特征改变）；注入内容不污染指令通道（沿用 §12.E）。
- **改动**：`harness-core/src/orchestrator/research.ts`（注入点）、记忆读写。
- **依赖**：S2-T4。

---

## 里程碑 C — 技能与闭环

### S2-T6 · Skill Runtime（声明式加载/触发/执行）
- **做**：`packages/harness-core/src/skills/*`。`SkillRuntime.load()`（从 config + 用户自建）、`match(query): SkillDef[]`（按 triggers）、`run(skill, input)`（按 `promptRef` + `tools` 编排）。把 Sprint 01 的研究流注册为内置 `research` skill，走 Skill Runtime 调度（而非硬编码）。
- **DoD**：`match('research the EV market')` 命中 `research` skill；`run` 复用 Orchestrator 完成研究；新增一个声明式 skill（如 `summarize-url`）无需改业务代码即可被 match/run。
- **改动**：`harness-core/src/skills/*`、`config/skills/*`、Orchestrator 接入。
- **依赖**：S2-T1（用户自建 skill 持久化）。

### S2-T7 · 闭环自动写 Skill（PRD §12.A）
- **做**：实现 `SkillRuntime.autoDraft(completedTask): SkillDef | null`。高质量收尾信号（用户点赞 / 导出 / 分享）触发，基于该任务的 plan/工具/格式起草可复用 `SkillDef`（声明式 Markdown）。`POST /api/tasks/:id/save-as-skill` 让用户审阅保存。
- **DoD**：一次成功研究后可一键「存为 Skill」，生成的 Skill 可被 S2-T6 match/run；草稿质量过 eval（结构齐全、promptRef 有效、risk 合理）。
- **改动**：`harness-core/src/skills/autodraft.ts`、`apps/bff` 路由 + UI 按钮。
- **依赖**：S2-T6。

### S2-T8 · Custom Skills 复跑（用户流三）
- **做**：用户自建/保存的 Skill CRUD（持久化）；在**新资料/新问题**上复跑保存的 Skill → 生成新结果。UI：Skill 列表 + 「复跑」入口。
- **DoD**：保存一个 Skill → 换一个问题复跑 → 得到结构一致的新成品；Skill 按 owner 隔离、可编辑、可删除。
- **改动**：`db-postgres` skills、`apps/bff` 路由 + UI、`harness-core` 调度。
- **依赖**：S2-T6、S2-T7。

---

## 里程碑 D — 平台增强

### S2-T9 · 流式综合（真实 token 流）
- **做**：generate 步从一次性 `router.json` 改为**两段式**：先 `router.complete` 流式产出报告正文（逐 token `delta` 事件，前端边写边显），再用一次轻量 `router.json` 抽取 `claims[]+sourceIds`（或从流式文本解析引用），保持引用完整性。
- **DoD**：Demo 中报告**逐字流式**出现（不再一次性整段）；引用正确性 eval 不退化；流中失败可回退（沿用 Router failover）。
- **改动**：`harness-core/src/orchestrator/research.ts`、可能新增引用抽取 prompt（config）。
- **依赖**：无（基于 Sprint 01 Router）。

### S2-T10 · Capability Probes + FeatureGate 运行时（「随模型增强」机制落地，ARCHITECTURE §3.2）
- **做**：实现能力探针套件（小 eval）校准 `ModelCaps`，并实现 `FeatureGate` 运行时判定：按当前路由模型的 `caps` 自动启用/降级特性、挂载/退役 `scaffold`。把至少一个特性（如 `multi_tool_plan` 或 `auto_skill_write`）真正受 gate 控制。
- **DoD**：模型 caps 达标 → 特性自动开启；不达标 → 降级到 scaffold 路径；探针随 `pnpm eval` 跑并回写 caps；切换 gate 有单测覆盖。
- **改动**：`harness-core/src/router/probes.ts`、`FeatureGate` 评估器、`config/feature-gates.json` 接线、`evals/`。
- **依赖**：S2-T6（若 gate 控制 auto_skill_write）。

### S2-T11 · 配额与计费档（PRD §6.8）
- **做**：Freemium / Pro / Power 三档（先做 Freemium/Pro 两档）。基于 `UsageLedger` 的用量上限与拦截：超额返回 402/限流；高成本任务（研究/长文）显式成本提示。`plans` 配置 + 每用户用量累计（持久化）。
- **DoD**：Free 用户超出额度被拦截并提示升级；任务前显示预估成本；用量按 owner 持久累计、可查询。
- **改动**：`harness-core/src/cost/quota.ts`、`db-postgres` usage、`apps/bff` 中间件 + UI 提示。
- **依赖**：S2-T1、S2-T2。

---

## 里程碑 E — 质量闸门

### S2-T12 · Eval 扩展 + Postgres 集成测试
- **做**：扩 `evals/`：①记忆召回正确性（写入→recall 命中相关）②Skill 自动生成质量（autoDraft 结构/有效性）③多研究 golden（不同问题形态）④个性化生效（带/不带 user-model 输出差异）。Repo contract suite 同时跑内存 + Postgres。CI 接 postgres service。
- **DoD**：`pnpm eval` 覆盖以上；CI 必过；故意破坏（断记忆召回 / 坏 skill 草稿 / 越额不拦截）任一即变红。
- **改动**：`evals/*`、CI（postgres service + 集成测试 job）。
- **依赖**：S2-T4、S2-T7、S2-T11。

### S2-T13 · 文档回写 + Sprint Demo 升级
- **做**：更新 README/ARCHITECTURE/CLAUDE/AGENTS（新命令：`db:migrate`、`db:up`；新模块；env：`DATABASE_URL`）。Demo 升级为完整 Sprint 02 流程（登录→项目→研究→记忆生效→存为 Skill→复跑→重启数据仍在）。
- **DoD**：新人/新代理按 README 一条命令起本地（含 PG）；命令与实际一致；Demo 走通端到端。
- **依赖**：S2-T1…T12。

---

## 执行顺序与并行建议

```
S2-T1(Postgres) ──┬─ S2-T2(Auth) ─ S2-T3(Projects)
                  ├─ S2-T4(Memory) ─ S2-T5(注入研究流)
                  └─ S2-T6(Skill Runtime) ─ S2-T7(自动写) ─ S2-T8(复跑)
S2-T9(流式综合) ── 独立，可随时并行
S2-T10(Probes/Gate) ── 依赖 T6（若 gate 控 auto_skill_write）
S2-T11(配额) ── 依赖 T1/T2
                                      └─ 全部收口 → S2-T12(Eval) → S2-T13(Docs/Demo)
```
- **关键路径**：S2-T1（Postgres）是地基，解锁 T2/T3/T4/T6/T11。
- **可并行**：T1 落地后，账号线（T2-T3）、记忆线（T4-T5）、技能线（T6-T8）三线并行；T9 完全独立。
- **每完成一个任务**：跑该模块单测 + 相关 eval；一任务一 PR，CI 绿即合；提交说明写清「动了哪个注册点 + 加了哪个 eval」。

## Sprint 02 Definition of Done（整体验收）— ✅ 全部达成
- [x] 数据持久化：重启服务后任务/项目/记忆/技能仍在（Postgres）。
- [x] 多用户：登录后数据按 owner 隔离，互不可见。
- [x] 项目：项目内研究注入项目背景与素材（systemAddendum / extraEvidence）。
- [x] 记忆：用户偏好/风格注入后续研究；记忆可见/可编辑/可删除。
- [x] 技能：一次研究可「存为 Skill」，并在新问题上一键复跑。
- [x] 流式：报告逐 token 流式呈现（127 delta），引用正确性不退化。
- [x] FeatureGate：特性按模型 caps 自动启用/降级（探针校准 + scaffold 退役）。
- [x] 配额：Free 超额返回 402 并提示；任务前返回预估成本。
- [x] `pnpm eval` 含记忆召回/Skill 质量/个性化；Repo contract 同跑内存+Postgres；CI 全门禁绿（含 PG service）。
- [x] README/命令/架构文档一致更新；Demo 端到端走通。

> Sprint 02 完成。S2-T1–T13 全部合并到 `main`（PR #13–#18），CI 全门禁绿（含 Postgres service）。

## 风险与提示（给代理）
- **Postgres in CI**：用 GitHub Actions `services: postgres`，集成测试读 `DATABASE_URL`；无 DB 时集成测试 `skipIf`，单测仍用内存实现保证离线可跑。
- **Auth 取舍**：先做最简单够用的（session cookie 或 token），写明选择与后续升级路径；不在本 Sprint 追求完整账号体系。
- **记忆与隐私**：记忆是高敏感数据——默认本人可见、可删、可关；不可信召回内容仍走数据通道。
- **流式 + 结构化**：别为「流式时拿不到结构化引用」写死后处理；采用「流正文 + 轻量 json 抽引用」两段式，或把引用抽取做成可退役 scaffold（公理 1）。
- **不要扩范围**：媒体/翻译/新产品面一律 Sprint 03；本 Sprint 只把「持久化·个人化·技能复用」打穿。
- **不确定/不可逆**（迁移删列、数据导出格式）→ 选合理默认并在 PR 标注；破坏性 DB 操作先确认。
