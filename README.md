# Apolla AI

面向个人知识工作的 AI 工作台，采用 **Harness 架构**：模型是可替换、持续变强的能力提供者；平台只做路由、上下文、工具、记忆、安全、评测、交付。模型变强 → 平台能力自动变强。

> 文档：[架构总纲](docs/ARCHITECTURE.md) · [PRD](docs/PRD.md) · [开发计划](docs/DEVELOPMENT_PLAN.md) · Sprint [01](docs/SPRINT_01.md)–[10](docs/SPRINT_10.md) · 代理约定 [AGENTS.md](AGENTS.md) / [CLAUDE.md](CLAUDE.md)

## 状态

**Sprint 01–10 完成** —— 从研究→成品骨架，升级为持久化、多用户、有记忆、技能可复用、支持多模态成品（文生图/视频）、具备工具生态与低风险执行（MCP + Agent + 分级确认 + 审计）、能主动运行（定时任务 + 后台 Job + 通知）、具备 Cowork 集成式自治（角色化 Plugins + 子代理并行编排 + 澄清机制）、拥有版本化项目文件区（文件感知工具 + Writer + Cowork 文件协作）、提供文本产品面（翻译 / 表格 / 会议纪要）、配有生产级 Web 前端（`apps/web`：Vite + React SPA）、并完成 **生产硬化与安全（真实鉴权 + 多租户隔离 + 限流 + 安全头 + 可观测性 + Job 持久恢复）**的工作台。
- **Harness Core**：Model Router（failover/多密钥）、Prompt Registry、Tool Runtime（Web Search）、Safety & Policy（三级权限 + 防注入）、Cost Ledger、研究状态机（流式综合）、FeatureGate 运行时。
- **持久化与账号**：Postgres（接口的 PG 实现）、最小 Auth、Projects。
- **个人化**：Memory（FTS 检索 + 用户模型 + 注入研究流）。
- **技能**：Skill Runtime + 闭环自动写 Skill + 复跑；配额/计费档。
- **多模态（Sprint 03）**：**Media Adapter**（`image_*`/`video_*` 别名）+ 图像/Seedance 2.0 视频 provider（离线 stub 兜底）、异步媒体编排 + 对象存储、内容审核（生成前后）、媒体成本/视频二次确认、媒体 Skill、研究→媒体串联（一键封面/讲解短视频，内嵌报告）。
- **工具生态与执行（Sprint 04）**：真实 **MCP 连接器**（`connectMCP`，stdio + 内置 stub）、连接器管理（持久化、单工具开关、**密钥加密**）、**多工具 Agent**（plan→工具循环→交付）、**分级执行**（只读自动 / 低风险写入需人类确认 / 高风险拒绝）、工具输出防注入、**审计日志**。
- **主动智能（Sprint 05）**：任意运行作为**后台 Job**（异步、run-log 可重放、断连重连）、**cron 定时任务**（存为"每日早报"等）、**通知/收件箱**（Job 完成站内 feed + webhook stub）；**后台执行安全**（无人确认 → 只读或预授权白名单，high_write 永拒；配额计入后台）。
- **Cowork 模式（Sprint 06）**：**角色化 Plugins**（打包 skills + 所需连接器 + 命令，按 owner 安装即生效；官方包一键装）、**子代理并行编排**（Coordinator 把目标 fan-out 给有界子代理——各为一次完整 agent 运行、继承 Safety 三级 + 审计——并发/总量封顶后汇总）、**澄清机制**（不确定时主动提问；后台无人 → 安全降级、**绝不自答**）；Cowork 作为 Job 前台/后台/定时运行。
- **Workspace & Files（Sprint 07）**：**版本化项目文件区**（写入追加新版本 / 历史 / 读旧版 / 回滚；按 owner-project 隔离；**路径规范化 + 越界拒绝**）、**文件感知工具**（`fs_read`/`fs_list` 自动 + `fs_write` 低风险，读到的内容走 untrusted 数据通道）、**Writer**（对工作区文档 AI 编辑产出新版本）、**Cowork 文件协作**（子代理各写 `sections/*` → 汇总读回拼 `brief.md`，受 fs_write 授权约束）；写入计入**配额 + 落审计**。
- **文本产品面（Sprint 08）**：声明式 **Surface substrate**（capability-as-config：输入类型 + 参数 + promptRef + 输出 mime + executor，新增面 ≈ 配置 + executor）+ 三个面 —— **翻译**（保 Markdown 结构）、**表格**（结构化表 zod 校验 + AI 加列产新版本）、**会议纪要**（转写 → 结构化摘要/决策/行动项）；产物经工作区 guard（路径/配额/审计），输入走 untrusted 数据通道，结构化输出 zod 校验失败安全降级。
- **生产前端（Sprint 09）**：`apps/web`（Vite + React + TS strict）—— 设计系统 + 应用外壳 + 路由 + 鉴权（受保护路由）、**类型化 API 客户端 + SSE hook**（卸载清理）；五大产品页：研究（流式）/工作区+Writer/Surfaces/Agent+Cowork+Plugins/自动化+设置，全部消费 BFF 现有 HTTP/SSE 接口（前端为纯客户端，不旁路后端）；Markdown 安全渲染、错误边界、响应式。
- **生产硬化与安全（Sprint 10）**：**真实鉴权**（邮箱+密码 scrypt 哈希 + 签名 httpOnly 服务端会话，过期+轮换+登出失效；demo 模式保留零配置登录）、**多租户隔离**（每个 `:id`/SSE/确认端点校验 ownerId，fail-closed；审计修复 4 处 IDOR）、**限流**（per-IP + 昂贵端点 per-owner 令牌桶，429 + Retry-After）、**安全周界**（CSP/nosniff/frame-deny + CORS 白名单 + body 上限）、**可观测性**（脱敏结构化日志 + request-id + `/metrics`）、**Job 持久恢复**（启动对账残留 Job → interrupted）+ 优雅停机。
- **Demo**：`apps/bff` 内联工作台（零配置兜底）—— 登录 → 研究/Agent → 定时任务 → 后台 → 历史+通知 → 导出；MCP → Agent → 确认 → 审计；Plugin → Cowork → fan-out → 汇总；`report.md` → Writer → 回滚 → 下载；会议纪要/翻译/表格。生产体验见 `apps/web`。

## 快速开始

```bash
pnpm install
pnpm dev          # 启动 Demo（apps/bff）→ http://localhost:3000
```

无需任何密钥即可体验（离线 demo 模式 + 内存持久化）。打开浏览器：登录（demo 模式任意邮箱即可；生产模式需密码）→ 可选建项目/设偏好 → 输入研究问题 → 看分阶段进度与**逐字流式**报告、来源、实时成本 → 「★ 存为 Skill」→ 用 Skill 下拉在新问题上复跑 → 导出 `.md`/`.html`。

**开启持久化（Postgres）**：

```bash
pnpm db:up        # docker 起本地 Postgres
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/apolla
pnpm dev          # BFF 自动迁移 + 切到 Postgres，数据重启后仍在
```

**生产前端（`apps/web`）**：在另一个终端起前端，Vite dev 把 `/api`·`/media` 代理到 BFF：

```bash
pnpm dev          # 终端 A：BFF（http://localhost:3000）
pnpm dev:web      # 终端 B：Web 前端（http://localhost:5173）
```

打开 `http://localhost:5173` → 登录 → 侧栏在 研究 / 工作区 / Surfaces / Agent & Cowork / 自动化 / 设置 间切换。前端是纯 API 客户端，所有数据/流式都经 BFF。`apps/bff` 的内联工作台仍可在 `:3000` 作为零配置兜底。

**接真实模型/搜索/媒体**：复制 `.env.example` 为 `.env`，填 `OPENAI_API_KEY` + `ANTHROPIC_API_KEY`（LLM，`OPENAI_API_KEY` 同时用于文生图）、`TAVILY_API_KEY`（搜索）、`SEEDANCE_API_KEY` + `SEEDANCE_BASE_URL`（文生视频）。会话签名 `SESSION_SECRET`；本地媒体存储目录 `MEDIA_DIR`；连接器密钥加密 `SECRETS_KEY`；本地 MCP server 经连接器的 stdio transport 接入。无对应 key 时该模态/工具自动回退到确定性 stub。

**生产硬化（Sprint 10）**：默认是 **demo 模式**（邮箱即登录，零配置）。上生产前设：
- `AUTH_MODE=password`（或 `NODE_ENV=production`）：登录/注册要求密码（scrypt 哈希）；会话为签名 httpOnly cookie（生产带 `Secure`），`SESSION_SECRET` 必须设强随机值。
- `CORS_ORIGIN=https://你的前端域`（逗号分隔多个）：跨源 SPA 的 CORS 白名单（带凭据）。同源/Vite 代理无需设。
- 限流：`RATE_IP_RPS`/`RATE_IP_BURST`（per-IP）、`RATE_OWNER_RPS`/`RATE_OWNER_BURST`（昂贵端点 per-owner）；`MAX_BODY_BYTES`（请求体上限，默认 1 MB）；`SESSION_TTL_MS`（会话时长）。
- 运维：`GET /metrics`（聚合计数/延迟，无敏感数据）；每请求 `x-request-id` + 脱敏结构化访问日志；启动自动对账残留 Job（标 `interrupted`），`SIGTERM` 优雅停机。每个 `:id` 端点按 owner 隔离（跨租户 fail-closed）。

## 命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 启动 BFF（`apps/bff`，热重载） |
| `pnpm dev:web` | 启动 Web 前端（`apps/web`，Vite dev，代理到 BFF） |
| `pnpm typecheck` | 全包 TS 类型检查（含 `apps/web`） |
| `pnpm lint` | ESLint |
| `pnpm test` | vitest 单测（node 包；`apps/web` 见下） |
| `pnpm test:web` | Web 前端组件/客户端测试（vitest + jsdom + RTL） |
| `pnpm build` | 各包 tsc 产物 + Web 前端 vite build |
| `pnpm eval` | 34 项：研究 + 记忆/Skill/个性化 + 媒体 + 执行(MCP/确认/注入/审计) + 自治(调度/后台重放/通知/后台安全) + Cowork(Plugin/子代理封顶/澄清门控/端到端/安全继承) + Workspace(版本/文件工具安全/越界/Writer/Cowork文件协作) + Surfaces(翻译/表格/会议纪要/落工作区/结构化校验) |
| `pnpm contract-test` | Provider 契约测试 |
| `pnpm db:up` / `db:down` | 启停本地 Postgres（docker） |
| `pnpm db:migrate` | 迁移 schema（读 `DATABASE_URL`） |

要求：Node ≥ 20，pnpm 9。CI（`.github/workflows/ci.yml`）对每个 PR 跑 typecheck · lint · test · **test:web** · build · **eval** 全门禁。

## 仓库布局（详见 [ARCHITECTURE §7](docs/ARCHITECTURE.md)）

```
packages/
  contracts/        # ★ 单一事实源：zod 类型 + 派生 JSON Schema
  config/           # ★ 注册表即配置：routes.json / feature-gates / prompts / skills + 加载器
  harness-core/     # ★ Harness：Router · Prompt Registry · Tool Runtime · Safety · Cost · Orchestrator
  adapters/
    llm/{openai,anthropic}/    search/{stub,tavily}/
apps/bff/           # BFF：研究→成品 API(SSE) + 内联工作台（组合根；唯一后端）
apps/web/           # ★ 生产前端：Vite + React SPA，消费 BFF HTTP/SSE（Sprint 09）
evals/              # 研究 golden + 引用/成本回归门禁
workers/            # （后续）
```

## 工程铁律（节选）

禁止硬编码模型名（只用 `gpt_fast`/`gpt_premium`/`claude_write`/`claude_premium` 别名，映射在 `packages/config/routes.json`）；禁止内联 Prompt（声明式 `config/prompts/*.md`）；外部内容走数据通道防注入；每个能力配 eval。完整见 [AGENTS.md](AGENTS.md)。

> 注：内部包通过 `exports` 指向 TS 源码（`src/index.ts`），开发期由 vitest/tsc/tsx 直接消费，无需预先 build；生产打包时再切到 `dist`。
