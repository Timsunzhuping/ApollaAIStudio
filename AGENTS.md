# AGENTS.md — Apolla AI（Codex / Claude Code / 任意编码代理）

本文件是所有 AI 编码代理的入口约定（Codex 读 `AGENTS.md`，Claude Code 读 `CLAUDE.md`，二者内容一致）。**动手前先读：**
1. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §1 / §3 / §4 / §9 —— Harness 架构与升级机制（最重要）。
2. [docs/PRD.md](docs/PRD.md) —— 对应功能 §。
3. [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md) —— 对应阶段 `[ ]` 任务。
4. [CLAUDE.md](CLAUDE.md) —— 铁律全文。
5. **当前 Sprint**：[docs/SPRINT_03.md](docs/SPRINT_03.md) —— 多模态成品：文生图/视频 + Media Adapter + Seedance（**从 S3-T1 开始**）。Sprint 01（[SPRINT_01](docs/SPRINT_01.md)）+ Sprint 02（[SPRINT_02](docs/SPRINT_02.md)）已完成。

## 平台是什么
Apolla AI 是面向个人知识工作的 AI 工作台，**采用 harness 架构**：模型（GPT/Claude 及图像/视频/语音模型）是可替换、持续变强的能力提供者；平台只做路由、上下文、工具、记忆、安全、评测、交付。**模型变强 → 平台能力自动变强，无需重写产品代码。** 价值闭环：可信研究 → 一键成品 → 低风险执行。

## 四条架构公理（不可违背）
1. **模型前向**：默认调用模型能力；只在 eval 证明必要时加脚手架，且脚手架必须可退役（挂 `FeatureGate.scaffold`）。
2. **能力即配置**：模型/Prompt/工具/技能/媒体/连接器/策略 = 注册表 + 版本化 + 灰度 + 回滚。
3. **升级即换挡**：升级模型/Provider = 改注册表 + 过 eval + 灰度；不改调用方。
4. **评测即安全网**：每个能力都有 golden 用例；任何变更先过五类回归（质量/引用/成本/工具成功率/安全）。

## 工程铁律（与 CLAUDE.md 同步）
1. 禁止硬编码模型名；只用逻辑别名 `gpt_fast`/`gpt_premium`/`claude_write`/`claude_premium`（媒体：`image_*`/`video_*`），由 Router/Media Adapter 映射。
2. 禁止内联 Prompt；进 Prompt Registry，按 `prompt_id@version` 取。
3. 每次用户任务 = Task 对象（可观察/可计费/可回放/可归档）。
4. 默认结构化输出（JSON Schema）。
5. 每条研究结论可回溯到来源。
6. 自动化三级：只读（自动）/ 低风险（确认）/ 高风险（MVP 不做）；失败切只读。
7. 外部内容默认不可信（防 prompt 注入）：走数据通道，不进指令通道；不可信内容触发的动作强制确认。
8. 外部工具优先 MCP 接入，不写 bespoke 集成。
9. Skill = 声明式 Markdown（兼容 agentskills.io），与 Prompt Registry 同源；高质量任务收尾可闭环自动起草 Skill。
10. 可执行工具一律进沙箱/VM + 每任务工具 allowlist；异步 Worker/Artifact 用 serverless 休眠控成本。
11. 媒体生成走统一 Media Adapter（含 Seedance 2.0），异步 + 成本预估 + 内容审核。
12. Cowork 模式 = 集成式旗舰模式（Plugins + 子代理 + 桌面文件区 + 主动澄清 + VM 隔离），不绕过权限分级、不做无确认全自治。

## 工作约定
- 任务最小单元 = 开发计划的 `[ ]`，一次一项，自带 eval。
- 实现顺序：数据模型/Schema → 适配器/注册 → 编排 → UI。
- 改动应集中在 `packages/harness-core` / `packages/adapters` / `packages/config` / `evals`；若 diff 大量落业务/UI 做能力补偿，停下来重审分层（违反公理 1）。
- 新增能力 = 一个适配器 + 一段配置 + 一个 eval；接 Cost Ledger。
- 不确定 / 不可逆动作 → 停下来问，不要猜测执行。
- 提交说明写清：动了哪个注册点、加了哪个 eval、是否涉及脚手架/FeatureGate 变更。

## Definition of Done
统一适配器接入（无硬编码）｜golden eval + 五类回归无退化｜受 Safety & Policy 约束｜计入 Cost Ledger｜脚手架带退役开关｜contract test 通过。

## 命令
`pnpm dev`（Demo BFF → http://localhost:3000，离线无需密钥）｜ `pnpm typecheck` ｜ `pnpm lint` ｜ `pnpm test` ｜ `pnpm build` ｜ `pnpm eval`（golden + 引用/成本 + 记忆/Skill/个性化）｜ `pnpm contract-test` ｜ `pnpm db:up`/`db:migrate`（Postgres）。
每个能力落地后至少跑 `pnpm typecheck && pnpm test && pnpm eval`；CI 对每个 PR 跑全部门禁（含 Postgres service）。env：`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`TAVILY_API_KEY`（真实模型/搜索）、`DATABASE_URL`（持久化）、`SESSION_SECRET`（会话）。
