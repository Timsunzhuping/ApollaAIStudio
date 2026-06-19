# Apolla AI

面向个人知识工作的 AI 工作台，采用 **Harness 架构**：模型是可替换、持续变强的能力提供者；平台只做路由、上下文、工具、记忆、安全、评测、交付。模型变强 → 平台能力自动变强。

> 文档：[架构总纲](docs/ARCHITECTURE.md) · [PRD](docs/PRD.md) · [开发计划](docs/DEVELOPMENT_PLAN.md) · [当前 Sprint](docs/SPRINT_01.md) · 代理约定 [AGENTS.md](AGENTS.md) / [CLAUDE.md](CLAUDE.md)

## 状态

Sprint 01 进行中（空仓库 → Harness Core 骨架 + 第一条「研究→成品」闭环）。**已落地 T1–T3**：monorepo 工具链、`@apolla/contracts`（共享类型/JSON Schema）、`@apolla/config`（注册表与加载器）。

## 快速开始

```bash
pnpm install
pnpm typecheck   # 全包类型检查
pnpm lint        # ESLint
pnpm test        # vitest（contracts + config 单测）
pnpm build       # 各包 tsc 产物
```

要求：Node ≥ 20，pnpm 9。复制 `.env.example` 为 `.env` 填入模型/工具 key（T4/T6 起需要）。

## 仓库布局（节选，详见 ARCHITECTURE §7）

```
packages/
  contracts/   # ★ 单一事实源：zod 类型 + 派生 JSON Schema（无硬编码模型名约定的根基）
  config/      # ★ 注册表即配置：routes.json / feature-gates.json + 校验加载器
  harness-core/  (T4+)  adapters/ (T4/T6+)
apps/web/      (T12/T13)
workers/       (后续)
evals/         (T14)
```

## 工程铁律（节选）

禁止硬编码模型名（只用 `gpt_fast`/`gpt_premium`/`claude_write`/`claude_premium` 别名，映射在 `packages/config/routes.json`）；禁止内联 Prompt；外部内容走数据通道防注入；每个能力配 eval。完整见 [AGENTS.md](AGENTS.md)。

> 注：内部包通过 `exports` 指向 TS 源码（`src/index.ts`），开发期由 vitest/tsc 直接消费，无需预先 build；生产打包时再切到 `dist`。
