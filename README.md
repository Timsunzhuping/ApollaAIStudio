# Apolla AI

面向个人知识工作的 AI 工作台，采用 **Harness 架构**：模型是可替换、持续变强的能力提供者；平台只做路由、上下文、工具、记忆、安全、评测、交付。模型变强 → 平台能力自动变强。

> 文档：[架构总纲](docs/ARCHITECTURE.md) · [PRD](docs/PRD.md) · [开发计划](docs/DEVELOPMENT_PLAN.md) · [Sprint 01](docs/SPRINT_01.md) · 代理约定 [AGENTS.md](AGENTS.md) / [CLAUDE.md](CLAUDE.md)

## 状态

**Sprint 01–05 完成** —— 从研究→成品骨架，升级为持久化、多用户、有记忆、技能可复用、支持多模态成品（文生图/视频）、具备工具生态与低风险执行（MCP + Agent + 分级确认 + 审计）、**并能主动运行（定时任务 + 后台 Job + 通知）**的工作台。
- **Harness Core**：Model Router（failover/多密钥）、Prompt Registry、Tool Runtime（Web Search）、Safety & Policy（三级权限 + 防注入）、Cost Ledger、研究状态机（流式综合）、FeatureGate 运行时。
- **持久化与账号**：Postgres（接口的 PG 实现）、最小 Auth、Projects。
- **个人化**：Memory（FTS 检索 + 用户模型 + 注入研究流）。
- **技能**：Skill Runtime + 闭环自动写 Skill + 复跑；配额/计费档。
- **多模态（Sprint 03）**：**Media Adapter**（`image_*`/`video_*` 别名）+ 图像/Seedance 2.0 视频 provider（离线 stub 兜底）、异步媒体编排 + 对象存储、内容审核（生成前后）、媒体成本/视频二次确认、媒体 Skill、研究→媒体串联（一键封面/讲解短视频，内嵌报告）。
- **工具生态与执行（Sprint 04）**：真实 **MCP 连接器**（`connectMCP`，stdio + 内置 stub）、连接器管理（持久化、单工具开关、**密钥加密**）、**多工具 Agent**（plan→工具循环→交付）、**分级执行**（只读自动 / 低风险写入需人类确认 / 高风险拒绝）、工具输出防注入、**审计日志**。
- **主动智能（Sprint 05）**：任意运行作为**后台 Job**（异步、run-log 可重放、断连重连）、**cron 定时任务**（存为"每日早报"等）、**通知/收件箱**（Job 完成站内 feed + webhook stub）；**后台执行安全**（无人确认 → 只读或预授权白名单，high_write 永拒；配额计入后台）。
- **Demo**：`apps/bff` —— 登录 → 研究/Agent → 存为定时任务 → 后台运行 → 历史+通知 → 导出；连接 MCP → 跑 Agent → 低风险写入弹确认 → 审计。

## 快速开始

```bash
pnpm install
pnpm dev          # 启动 Demo（apps/bff）→ http://localhost:3000
```

无需任何密钥即可体验（离线 demo 模式 + 内存持久化）。打开浏览器：登录（任意邮箱）→ 可选建项目/设偏好 → 输入研究问题 → 看分阶段进度与**逐字流式**报告、来源、实时成本 → 「★ 存为 Skill」→ 用 Skill 下拉在新问题上复跑 → 导出 `.md`/`.html`。

**开启持久化（Postgres）**：

```bash
pnpm db:up        # docker 起本地 Postgres
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/apolla
pnpm dev          # BFF 自动迁移 + 切到 Postgres，数据重启后仍在
```

**接真实模型/搜索/媒体**：复制 `.env.example` 为 `.env`，填 `OPENAI_API_KEY` + `ANTHROPIC_API_KEY`（LLM，`OPENAI_API_KEY` 同时用于文生图）、`TAVILY_API_KEY`（搜索）、`SEEDANCE_API_KEY` + `SEEDANCE_BASE_URL`（文生视频）。会话签名 `SESSION_SECRET`；本地媒体存储目录 `MEDIA_DIR`；连接器密钥加密 `SECRETS_KEY`；本地 MCP server 经连接器的 stdio transport 接入。无对应 key 时该模态/工具自动回退到确定性 stub。

## 命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 启动 Demo BFF（`apps/bff`，热重载） |
| `pnpm typecheck` | 全包 TS 类型检查 |
| `pnpm lint` | ESLint |
| `pnpm test` | vitest 单测（含离线端到端 demo 测试） |
| `pnpm build` | 各包 tsc 产物 |
| `pnpm eval` | 19 项：研究 + 记忆/Skill/个性化 + 媒体 + 执行(MCP/确认/注入/审计) + 自治(调度/后台重放/通知/后台安全) |
| `pnpm contract-test` | Provider 契约测试 |
| `pnpm db:up` / `db:down` | 启停本地 Postgres（docker） |
| `pnpm db:migrate` | 迁移 schema（读 `DATABASE_URL`） |

要求：Node ≥ 20，pnpm 9。CI（`.github/workflows/ci.yml`）对每个 PR 跑 typecheck · lint · test · build · **eval** 全门禁。

## 仓库布局（详见 [ARCHITECTURE §7](docs/ARCHITECTURE.md)）

```
packages/
  contracts/        # ★ 单一事实源：zod 类型 + 派生 JSON Schema
  config/           # ★ 注册表即配置：routes.json / feature-gates / prompts / skills + 加载器
  harness-core/     # ★ Harness：Router · Prompt Registry · Tool Runtime · Safety · Cost · Orchestrator
  adapters/
    llm/{openai,anthropic}/    search/{stub,tavily}/
apps/bff/           # Demo：研究→成品 API(SSE) + 三栏工作台（组合根）
evals/              # 研究 golden + 引用/成本回归门禁
workers/            # （后续）
```

## 工程铁律（节选）

禁止硬编码模型名（只用 `gpt_fast`/`gpt_premium`/`claude_write`/`claude_premium` 别名，映射在 `packages/config/routes.json`）；禁止内联 Prompt（声明式 `config/prompts/*.md`）；外部内容走数据通道防注入；每个能力配 eval。完整见 [AGENTS.md](AGENTS.md)。

> 注：内部包通过 `exports` 指向 TS 源码（`src/index.ts`），开发期由 vitest/tsc/tsx 直接消费，无需预先 build；生产打包时再切到 `dist`。
