# Sprint 01 执行单 — 空仓库 → Harness Core 骨架 + 第一条「研究→成品」闭环

> 读者：**Codex / Claude Code**。逐任务从上往下执行；每个任务自带验收（DoD）。
> 前置必读：[ARCHITECTURE.md](./ARCHITECTURE.md) §1/§3/§4/§9 · [AGENTS.md](../AGENTS.md) · [PRD.md](./PRD.md) §6.2。
> 目标产物（Sprint Demo）：在网页输入一个问题 → 系统自动「拆解→搜索→抽取→带引用综合→生成报告」→ 右栏显示来源 → 一键导出 Markdown/HTML。**全链路走 Harness Core，不旁路。**

## 0. Sprint 范围与非目标

**做（walking skeleton，端到端打通一条线）**
- Monorepo + 工具链 + CI。
- Harness Core 骨架：Model Router(+OpenAI/Anthropic 适配)、Prompt Registry、Tool Runtime(+Web Search)、Safety(最小)、Cost Ledger、Task Orchestrator(研究状态机)。
- 一条「研究→成品」闭环 + 最小 Web UI + 导出。
- 1 个 golden eval + 引用正确性检查接入 CI。

**不做（留待后续 Sprint）**
- 浏览器扩展、媒体生成、Memory、Skills 市场、Cowork、计费 UI、多端、鉴权体系（Sprint 1 用单用户 stub）。
- 持久化用 **Repository 接口 + 内存实现**（Postgres 适配留接口，后续替换）。

**全程铁律**（违反即返工）：禁止硬编码模型名 / 内联 Prompt；外部内容走数据通道；每个能力配 eval；改动集中在 `harness-core`/`adapters`/`config`/`evals`。

---

## 里程碑 A — 仓库与工具链

### T1 · Monorepo 脚手架
- **做**：pnpm workspaces；TS 严格模式；eslint + prettier；vitest；GitHub Actions CI（typecheck + lint + test）。建立 [ARCHITECTURE §7](./ARCHITECTURE.md) 的目录骨架（先建空 `packages/*`、`apps/web`、`workers`、`evals`、`infra`）。
- **文件**：`package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`、`.eslintrc`、`.prettierrc`、`.github/workflows/ci.yml`、各 package 的占位 `package.json`+`index.ts`。
- **DoD**：`pnpm i && pnpm -r build && pnpm -r test` 通过；CI 绿。
- **依赖**：无。

### T2 · `packages/contracts`（单一事实源）
- **做**：定义共享类型与 JSONSchema（TS 与未来 Python worker 共用）。至少：`Task`、`Step`、`Source`/`Citation`、`Artifact`、`UsageRecord`、`LLMRequest`/`LLMChunk`、`ModelDescriptor`、`RouteConfig`、`PromptVersion`、`ToolResult`、`SkillDef`。字段对齐 [ARCHITECTURE §3/§6](./ARCHITECTURE.md)。
- **文件**：`packages/contracts/src/{task,model,prompt,tool,skill,usage}.ts` + 导出的 JSONSchema（用 `zod`→JSONSchema 或手写 schema）。
- **DoD**：类型可被其他包 import；`Task` 状态机枚举 = `plan|search|extract|compare|generate|deliver|done|failed`。
- **依赖**：T1。

### T3 · `packages/config`（注册表即配置）
- **做**：注册表以文件承载 + 加载器。`routes`（别名→primary+fallbackChain+keyPool）、`prompts`（指向 T6 Prompt 文件）、`skills`、`feature-gates`。提供 `loadRoutes()/loadPrompts()/...`，启动时校验 schema。
- **文件**：`packages/config/{routes.json,feature-gates.json}`、`packages/config/src/index.ts`。
- **DoD**：非法配置启动即报错；`routes.json` 含四别名 `gpt_fast/gpt_premium/claude_write/claude_premium` 映射（值用占位模型 id，集中此处）。
- **依赖**：T2。

---

## 里程碑 B — Harness Core 骨架

### T4 · Model Router + LLM 适配器
- **做**：`ModelRouter.complete(alias, req)`（流式）与 `json(alias, req, schema)`（结构化）。实现 `OpenAIAdapter`、`AnthropicAdapter` 统一 `LLMAdapter` 接口。failover 链 + 多密钥轮换 + 错误归一 + 失败降级（高阶失败→回退轻量+缩上下文）。读 T3 路由配置；模型 id 只存配置。
- **文件**：`packages/harness-core/src/router/*`、`packages/adapters/llm/openai/*`、`packages/adapters/llm/anthropic/*`。密钥走 env。
- **DoD**：单测（mock provider）覆盖：别名解析、primary 失败→fallback、`json()` schema 校验重试；一个真实 smoke 测试（带 env key 时）能流式返回。**业务层永不出现模型名字符串。**
- **依赖**：T2、T3。

### T5 · Prompt Registry
- **做**：从 `packages/config/prompts/*.md`（frontmatter：`promptId/version/scene/inputSchema/outputSchema/safetyConstraints/evalSet/rollout/rollbackTo`）加载；`get(promptId, {pin?})` 按版本取，按 `rollout` 灰度。
- **文件**：`packages/harness-core/src/prompts/*`、`packages/config/prompts/*.md`。
- **DoD**：取用返回模板 + schema；无内联 Prompt（grep 业务代码无长字符串提示词）。
- **依赖**：T2、T3。

### T6 · Tool Runtime + Web Search 工具 + 不可信输入封装
- **做**：`ToolRuntime.register(tool)` / `list(filter)`；预留 `connectMCP()` 接口（本 Sprint 可空实现）。实现 `WebSearchTool`（risk=`read`），provider 可插拔：一个真实适配（如 Tavily/Brave，env key）+ 一个 fixture stub（给 eval 用）。**工具返回内容统一包成 `UntrustedContent`**（带 source 元数据，标记为数据而非指令）。
- **文件**：`packages/harness-core/src/tools/*`、`packages/adapters/search/{tavily,stub}/*`。
- **DoD**：搜索返回结构化结果（title/url/snippet）；返回体类型为 `UntrustedContent`，下游只能作为数据注入。
- **依赖**：T2。

### T7 · Safety & Policy Engine（最小可用）
- **做**：风险分级判定（`read` 自动；`low_write` 需确认；`high_write` 拒绝）。**不可信输入策略**：提供 `wrapAsData(content)`，并提供组装函数确保外部内容只进"数据通道"（user/“documents”区），系统指令区不拼接外部内容。
- **文件**：`packages/harness-core/src/safety/*`。
- **DoD**：单测：`high_write` 被拒；构造一个含"忽略以上指令"的恶意网页片段，断言它不会进入系统指令、不会触发动作（prompt 注入基线用例）。
- **依赖**：T2、T6。

### T8 · Cost Ledger + Observability
- **做**：每次 LLM/工具调用写 `UsageRecord`（alias、tokens、$、provider、cacheHit）。Router/Tool 调用自动记账。基础 tracing（任务/步骤 span，console 或 OTel-ready 接口）。
- **文件**：`packages/harness-core/src/cost/*`、`.../obs/*`。
- **DoD**：跑一次研究任务后能打印「本任务总成本 + 分步成本」。
- **依赖**：T4、T6。

### T9 · Task Orchestrator（研究状态机）
- **做**：`Orchestrator.run(task)` 返回事件流（`AsyncIterable<TaskEvent>`）。实现研究状态机：`plan → search → extract → compare(可选) → generate → deliver`。每步是可回放的 `Step`，写入 `Task`。`Repository` 接口 + 内存实现保存 Task。长任务异步：先发 `plan` 事件（计划草图+预估），再逐步补结果。
- **文件**：`packages/harness-core/src/orchestrator/*`、`.../repo/{memory}.ts`。
- **DoD**：用 stub 搜索 + mock LLM，`run()` 能从问题走到 `done`，事件顺序正确，Task 可序列化回放。
- **依赖**：T4–T8。

---

## 里程碑 C — 垂直切片：研究 → 成品

### T10 · Research Skill + Prompts
- **做**：声明式 `research` Skill（`SkillDef` Markdown）。两个 Prompt：`research.plan@1`（拆解为子问题，结构化输出）、`research.synthesize@1`（基于检索证据**带引用**综合，输出含 `claims[]` 且每条挂 `sourceIds`）。规划走 `gpt_premium`，成稿走 `claude_write`（对齐 [PRD §6.1](./PRD.md)）。
- **文件**：`packages/config/skills/research.md`、`packages/config/prompts/research.plan.md`、`research.synthesize.md`。
- **DoD**：综合输出每条结论可回溯到 `Source`；无来源的结论被标记/剔除。
- **依赖**：T5、T9。

### T11 · Artifact / Export
- **做**：把综合结果渲染为报告 `Artifact`（Markdown，含引用脚注/来源列表）。导出器：Markdown → HTML（必做）、→ PDF（可选）。导出保留引用。
- **文件**：`packages/harness-core/src/artifact/*` 或 `apps/web` 服务端 + `packages/adapters/export/*`。
- **DoD**：同一 Task 产出可下载的 `.md` 与 `.html`，引用完整。
- **依赖**：T9、T10。

### T12 · BFF / API
- **做**：最小 API：`POST /tasks`（建研究任务）、`GET /tasks/:id/events`（SSE 流式事件）、`GET /tasks/:id`（结果）、`GET /tasks/:id/export?fmt=md|html`。单用户 stub 鉴权（固定 ownerId）。
- **文件**：`apps/web/app/api/*`（Next.js Route Handlers）或独立 `apps/bff`。
- **DoD**：curl 全流程：建任务→收到 plan/search/generate 事件→取报告→下载导出。
- **依赖**：T9、T11。

### T13 · 最小 Web UI（三栏工作区）
- **做**：对齐 [PRD §10 任务工作区](./PRD.md)：输入框（问题/链接）；左栏任务轨迹（plan/search/extract/generate）；中栏报告画布（流式渲染）；右栏来源列表 + 本任务成本；顶部「导出 MD/HTML」。
- **文件**：`apps/web/app/(workspace)/*`、组件 + SSE 客户端。
- **DoD**：浏览器里输入问题，可见分阶段进度、流式报告、来源、成本，能导出。**Sprint Demo 即此页。**
- **依赖**：T12。

---

## 里程碑 D — 质量闸门

### T14 · Eval Harness + Golden Case + CI 接入
- **做**：`evals/` 跑研究闭环：用 fixture 搜索（T6 stub，确定性）+ 真/mock LLM。实现三类检查：①golden 质量（结构/字段齐全）②**citation correctness**（每条 claim 的 sourceId 存在且片段可对应）③cost regression（成本不超基线阈值）。接入 CI（合并到主干跑）。
- **文件**：`evals/research/*`、`evals/runner.ts`、CI job。
- **DoD**：`pnpm eval` 输出通过/失败报告；CI 中 golden 用例为必过门禁；故意破坏引用时 eval 变红。
- **依赖**：T9–T11。

### T15 · README + 命令 + 文档回写
- **做**：根 `README.md`（快速启动、env 变量、架构图链接）。补全 `build/dev/test/lint/eval/contract-test` 命令脚本。把命令回写到 [ARCHITECTURE §11](./ARCHITECTURE.md)、[CLAUDE.md](../CLAUDE.md)、[AGENTS.md](../AGENTS.md) 的「命令」占位。
- **DoD**：新人/新代理克隆后按 README 一条命令起 dev；文档命令与实际一致。
- **依赖**：T1–T14。

---

## 执行顺序与并行建议

```
T1 → T2 → T3
        ├─ T4 ─┐
        ├─ T5 ─┤
        ├─ T6 → T7 ─┤
                     ├─ T8 → T9 → T10 → T11 → T12 → T13
                     │                 └────────────┐
                     └──────────────────────────────→ T14 → T15
```
- **可并行**：T4 / T5 / T6 在 T2+T3 后可并行（不同 adapter/模块）。
- **关键路径**：T9（Orchestrator）是收口点，T10–T13 依赖它。
- **每完成一个任务**：跑该模块单测 + 相关 eval；提交说明写清「动了哪个注册点 + 加了哪个 eval」。

## Sprint Definition of Done（整体验收）
- [ ] 空仓库 → `pnpm i && pnpm dev` 起得来。
- [ ] Web 输入一个真实问题，得到**带引用**的报告，左栏阶段轨迹可见，右栏来源+成本可见。
- [ ] 一键导出 `.md`/`.html`，引用完整。
- [ ] 全链路无硬编码模型名、无内联 Prompt；外部内容仅经数据通道。
- [ ] `pnpm eval` 含研究 golden + 引用正确性 + 成本回归，且接入 CI 为门禁。
- [ ] Cost Ledger 能给出单任务分步成本。
- [ ] README/命令/架构文档一致更新。

## 风险与提示（给代理）
- **搜索 provider** 需 env key；无 key 时自动用 stub，保证离线可跑 eval。
- **结构化输出**：综合阶段用 `json(alias, req, schema)` 强约束 `claims[]+sourceIds`，便于引用校验。
- **不要**为「模型偶尔漏引用」写死大段后处理规则；用 schema 约束 + eval 兜底，并把任何补偿逻辑挂 `FeatureGate.scaffold` 备注后续退役（公理 1）。
- **不确定**（如选 PDF 库、选搜索 provider）→ 选一个合理默认并在提交说明标注，不要停摆；仅在不可逆/外部副作用动作上停下来问。
