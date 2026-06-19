# Apolla AI

面向个人知识工作的 AI 工作台，采用 **Harness 架构**：模型是可替换、持续变强的能力提供者；平台只做路由、上下文、工具、记忆、安全、评测、交付。模型变强 → 平台能力自动变强。

> 文档：[架构总纲](docs/ARCHITECTURE.md) · [PRD](docs/PRD.md) · [开发计划](docs/DEVELOPMENT_PLAN.md) · [Sprint 01](docs/SPRINT_01.md) · 代理约定 [AGENTS.md](AGENTS.md) / [CLAUDE.md](CLAUDE.md)

## 状态

**Sprint 01 完成** — 空仓库 → Harness Core + 第一条「研究→成品」闭环 + 可演示 Demo。
Harness Core：Model Router（OpenAI/Anthropic 适配、failover、多密钥）、Prompt Registry、Tool Runtime（Web Search）、Safety & Policy（三级权限 + 不可信输入防护）、Cost Ledger、Task Orchestrator（研究状态机）。Demo：`apps/bff` 提供研究→报告→导出的 API(SSE) + 三栏工作台。

## 快速开始

```bash
pnpm install
pnpm dev          # 启动 Demo（apps/bff）→ http://localhost:3000
```

打开浏览器输入一个研究问题，即可看到分阶段进度、带引用的流式报告、来源与实时成本，并一键导出 `.md`/`.html`。
**无需任何密钥** —— 默认离线 demo 模式（内置 DemoLLMAdapter + 确定性 stub 搜索）。

配了密钥则自动切换到真实模型/搜索：复制 `.env.example` 为 `.env` 并填入
`OPENAI_API_KEY` + `ANTHROPIC_API_KEY`（真实 LLM）、`TAVILY_API_KEY`（真实 Web 搜索）。

## 命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 启动 Demo BFF（`apps/bff`，热重载） |
| `pnpm typecheck` | 全包 TS 类型检查 |
| `pnpm lint` | ESLint |
| `pnpm test` | vitest 单测（含离线端到端 demo 测试） |
| `pnpm build` | 各包 tsc 产物 |
| `pnpm eval` | LLM 产品 eval：研究 golden + 引用正确性 + 成本回归 |
| `pnpm contract-test` | Provider 契约测试 |

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
