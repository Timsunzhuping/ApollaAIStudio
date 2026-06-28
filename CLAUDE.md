# CLAUDE.md — Apolla AI 仓库指南

本文件为 Claude Code 提供每次会话的标准上下文。开始任何开发前请先读本文件，再读 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)（Harness 架构总纲）、[docs/PRD.md](docs/PRD.md) 与 [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md)。Codex 等其他代理读同源的 [AGENTS.md](AGENTS.md)。

**已完成 Sprint**：01（Harness Core）、02（持久化/个人化/技能）、03（多模态成品）、04（工具生态与低风险执行）、05（主动智能：定时 + 后台 Job + 通知）、06（[Cowork 模式](docs/SPRINT_06.md)）、07（[Workspace & Files](docs/SPRINT_07.md)）、08（[文本产品面](docs/SPRINT_08.md)）、09（[生产前端](docs/SPRINT_09.md)：`apps/web` Vite+React SPA）、10（[生产硬化与安全](docs/SPRINT_10.md)：真实鉴权 + 多租户隔离 + 限流 + 安全头 + 可观测性 + Job 持久恢复）、11（[开放工具生态](docs/SPRINT_11.md)：HTTP/SSE MCP transport + 连接器市场 + 远程工具安全/健康）、12（[浏览器扩展](docs/SPRINT_12.md)：MV3 划词研究/翻译/总结 + 侧边栏，API token 跨源鉴权 + SSE-over-fetch）。**API token**：scrypt 哈希、`apolla_<id>_<secret>`、Bearer 与会话并存、owner 隔离 + 限流；**扩展铁律**：纯 BFF 客户端、最小权限（`activeTab`+`scripting`，无 `<all_urls>`/静态 content script）、token 仅 `chrome.storage` 绝不进页面、页面内容 untrusted（安全 Markdown）。前端是纯 API 客户端（不旁路 BFF、不持密钥、SSE 必清理、Markdown 安全渲染）；BFF 仍是唯一后端。
**安全周界铁律（S10）**：密码 scrypt 哈希（绝不明文/入日志）；会话签名 httpOnly + 过期 + 登出失效；**每个 `:id`/SSE/确认端点必校验 ownerId（跨租户 fail-closed）**；昂贵端点限流；日志/`/metrics` 脱敏；demo 模式不削弱生产默认（`AUTH_MODE`/`CORS_ORIGIN` 切换）；残留 Job 启动对账为 `interrupted`。
执行铁律：外部工具优先 MCP；工具输出默认不可信（数据通道）；写入动作必经 Safety 三级——只读自动 / 低风险需人类确认 / 高风险拒绝；每次工具调用与确认落审计；连接器密钥加密。子代理继承全部执行安全；fan-out 有并发/总量上限；澄清绝不自答（后台返回 null → 安全降级）；后台/定时运行无人确认——默认只读或预授权白名单（上限 low_write），high_write 永拒；配额计入后台。文件路径必规范化 + 拒越界（`..`/绝对/跨 owner-project）；`fs_read` 内容是 untrusted 数据；`fs_write` 是 low_write；工作区写入计配额 + 落审计。**新增产品面用声明式 Surface（config + executor，不重写管线）；surface 输入走数据通道；产物只经工作区 guard；结构化输出 zod 校验，失败安全降级不写半成品。** 后续候选见 SPRINT_08 §0：表格公式引擎、ASR 语音、生产级 Next.js 前端、裸机本地目录、HTTP/SSE MCP transport、Plugin 市场。

## 产品是什么

Apolla AI 是面向个人知识工作的 AI 工作台。核心价值闭环：**可信研究 → 一键成品 → 低风险执行**。底层依赖 GPT 与 Claude，但把它们当作可替换的"能力提供者"，不绑定到任何具体模型版本。

定位：比 Monica 更深、比 Genspark 更轻、比 Manus 更易上手。

## 架构总纲：Harness（决定一切的元设计）

**平台 = Harness（薄编排层）+ 可插拔能力。模型变强 → 平台自动变强，无需重写产品代码。** 平台能力 ≈ 模型能力 × Harness 杠杆——工程价值在杠杆，不在重复模型已会做的事。四条公理（详见 [ARCHITECTURE.md §1](docs/ARCHITECTURE.md)）：① 模型前向（脚手架须可退役）② 能力即配置（注册表+版本化+灰度+回滚）③ 升级即换挡（改注册表，不改调用方）④ 评测即安全网（每个能力都有 eval）。**你写的代码几乎都是往 Harness Core 注册一个能力，而不是把逻辑焊死在某个模型或页面里。**

## 当前阶段

立项 / 架构阶段（开发计划阶段 0）。代码尚未开始。优先按开发计划阶段 0 冻结架构与数据模型。

## 不可违背的工程铁律

1. **禁止硬编码模型名。** 模型只通过逻辑别名访问：`gpt_fast`、`gpt_premium`、`claude_write`、`claude_premium`。映射由路由配置中心管理。
2. **禁止内联 Prompt。** 所有 Prompt 进 Prompt Registry，带版本号、I/O Schema、评测集、灰度开关、回滚版本。
3. **每次用户任务 = 任务对象**：可观察、可计费、可回放、可归档。状态机：plan → search → extract → compare → generate → deliver。
4. **默认结构化输出**（Structured Outputs / JSON Schema）。
5. **每条研究结论必须可回溯到来源**（来源列表 + 引用片段）。
6. **自动化分三级**：只读（自动）/ 低风险写入（需显式确认）/ 高风险写入（MVP 不做）。失败自动切只读模式。
7. **MVP 只做"研究到成品"闭环 + 受限侧边栏**；不做云浏览器登录、不替用户持有会话、不做团队/Connectors/BYOK。
8. **外部内容默认不可信**（防 prompt 注入）：网页/上传文件/工具/MCP 输出走"数据"通道而非"指令"通道；由不可信内容触发的动作强制确认、默认只读。
9. **外部工具优先用 MCP 接入**，不写 bespoke 集成；Tool Runtime 架构期即预留 MCP 抽象。
10. **Skill = 声明式 Markdown 文件**（兼容 agentskills.io），与 Prompt Registry 同源版本化；高质量任务收尾可由 agent 自动起草 Skill（闭环学习）。
11. **可执行工具一律进沙箱**：代码执行 / Artifact 运行 / 浏览器动作 = 容器隔离 + 每任务工具 allowlist；异步 Worker / Artifact 环境用 serverless 休眠控成本。
12. **媒体生成走统一 Media Adapter**：文生图/文生视频用逻辑别名（`image_fast`/`image_premium`/`video_standard`/`video_premium`）+ provider 适配器，配置即换模型（如 Seedance 2.0），禁止硬编码媒体模型名；视频一律异步任务对象 + 成本预估 + 生成前后内容审核。
13. **Cowork 模式 = 集成式旗舰模式**（对标 Claude Cowork）：在沙箱/VM 隔离中后台自治运行、连接真实应用（MCP 连接器）、按职能打包 Plugins（Skills+连接器+slash+子代理）、子代理编排、桌面文件工作区、不确定时主动澄清。**不绕过 §7 权限分级**，不做无确认全自治。详见 [docs/PRD.md §15](docs/PRD.md)。

> 第 8–11 条借鉴 OpenClaw / Hermes Agent，详见 [docs/PRD.md §12](docs/PRD.md)；第 12 条多媒体生成详见 [docs/PRD.md §13](docs/PRD.md)；Monica/Genspark 能力补全见 §14，Cowork 模式见第 13 条与 §15。

## 架构（四层）

- **前端触点层**：Next.js + TypeScript（Web App）、Browser Extension（MV3）、Desktop Shell（v1 后轻壳）。
- **产品中台层**：BFF/API Gateway、Auth/Billing/Usage Ledger、Conversation、Project/Memory、Artifact/Export、Search/RAG。
- **智能编排层**：Model Router、Prompt Registry、Tool Runtime、Workflow/Task Orchestrator、Safety & Policy Engine（Python AI Workers）。
- **基础设施层**：Postgres、Redis（缓存/队列）、S3/OSS、pgvector/Qdrant、观测/分析。

> 真正复杂的是智能编排，不是 CRUD。MVP 不要过度微服务。

## 模型路由默认策略

| 场景 | 别名 |
|---|---|
| 普通聊天/轻总结 | `gpt_fast` |
| 长文改写/邮件/文案/润色 | `claude_write` |
| Deep Research 规划 / 综合 | 规划 `gpt_premium` / 成稿 `claude_write` |
| 结构化抽取/表格/API | `gpt_premium` + Structured Outputs |
| 多工具多步代理 | `claude_premium` 或 `gpt_premium`（按评测） |
| 失败降级 | 回退轻量模型 + 缩上下文 + 只读 |

## 缓存三层（必须全部吃满）

1. Provider Prompt Caching（OpenAI/Anthropic 自动缓存）。
2. 应用层结果缓存（语义缓存 + Artifact 可恢复缓存）。
3. 检索层缓存（chunk/embedding/rerank 复用）。

## 开发工作流约定

- 每个功能从**数据模型与 Schema** 开始 → 编排 → UI。
- 新增模型调用必经 Model Router + Prompt Registry。
- 每个 P0 功能落地时同步写 **LLM eval golden case**。
- 任务最小单元 = 开发计划里的 `[ ]` checklist 项。

## 测试（含 LLM 产品测试）

PR 必过：Type Check、Lint、Unit Test、Schema Test、Prompt 校验、Provider Contract Test。
LLM 测试四类：golden set 回归、citation correctness、cost regression、tool success regression。

## 北极星指标

每个留存用户每周完成的"有效工作流"数。其余 KPI 见 PRD 第 9 节。

## 命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 启动 Demo BFF（`apps/bff`）→ http://localhost:3000（离线 demo 模式，无需密钥） |
| `pnpm typecheck` | 全包 TS 类型检查 |
| `pnpm lint` | ESLint |
| `pnpm test` | vitest 单测 |
| `pnpm build` | 各包 tsc 产物 |
| `pnpm eval` | 35 项：研究 + 记忆/Skill/个性化 + 媒体 + 执行 + 自治 + Cowork + Workspace + Surfaces + 远程工具(HTTP MCP 端到端) |
| `pnpm contract-test` | Provider 契约测试 |
| `pnpm db:up` / `db:migrate` | 起本地 Postgres / 迁移 schema |

每个能力落地后至少跑 `pnpm typecheck && pnpm test && pnpm eval`。CI 对每个 PR 跑全部门禁（含 Postgres service）。真实模型/搜索/媒体：`.env` 配 `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`TAVILY_API_KEY`/`SEEDANCE_API_KEY`；持久化 `DATABASE_URL`；会话 `SESSION_SECRET`；媒体目录 `MEDIA_DIR`；计费 `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`STRIPE_PRICE_<PLAN>`（缺则回退 Stub 支付）。无 key 的模态自动回退 stub。媒体走统一 Media Adapter（`image_*`/`video_*` 别名，禁止硬编码媒体模型名）。计费走可插拔 PaymentProvider（Stub/Stripe）：卡号不落我方、Webhook 必验签+幂等、权益 fail-closed 回落 free、套餐限额声明式（`config/plans/*.json`）。
