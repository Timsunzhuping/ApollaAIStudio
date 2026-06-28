# Sprint 13 执行单 — Billing & Monetization：可插拔支付 + 套餐/权益 + Checkout/Webhook

> 读者：**Codex / Claude Code**。逐任务从上往下执行；每个任务自带验收（DoD）、依赖、改动位置。
> 前置必读：[ARCHITECTURE.md](./ARCHITECTURE.md) §1（公理③升级即换挡 / 适配器模式）· [AGENTS.md](../AGENTS.md) · `packages/harness-core/src/cost/`（`Quota` 已有 `planOf` seam、`PricingBook`、`CostLedger`）· Sprint 01–12（已完成）。
> 目标产物（Sprint Demo）：**升级套餐 → （Stub provider 离线模拟）Checkout 成功 → 订阅 active → 权益生效（pro 配额/功能解锁）→ 用量可见 → 取消回落 free。** 支付 Provider 可热插拔（Stub 离线 / Stripe 生产），全链路走 Harness，不旁路；卡号永不经我方服务器（provider 托管 Checkout）。

## 0. Sprint 范围与非目标

**主题**：十二个 Sprint 把产品做成了可上线、安全、生态开放、能触达任意网页的工作台——但**还不是生意**。已有的 `Quota`（free/pro）/`PricingBook`/`UsageRecord`/`CostLedger` 是底座却没被用起来：无法订阅、无套餐权益、无变现。本 Sprint 用 harness 的招牌动作——**可插拔 capability provider**——把这些底座变成真实业务：`PaymentProvider` 适配器（**Stripe 生产 / Stub 离线**，与 LLM/媒体/搜索适配器同构）、声明式套餐/权益、Checkout/Webhook 生命周期、套餐门禁。变现是"升级即换挡"公理在计费上的应用。

**做（本 Sprint 的闭环）**
- 支付 Provider：`PaymentProvider` 接口（createCheckout / getSubscription / cancel / parseWebhook+验签）+ `StubPaymentProvider`（离线确定性，同步模拟 Checkout 成功）+ `StripePaymentProvider`（fetch-based、无 SDK、env 门控、缺 key 回退 stub）。`Subscription` 契约 + `SubscriptionRepository`（内存 + Postgres）。
- 套餐/权益：声明式套餐 `config/plans/*.json`（free/pro/team：配额 + 功能位）；`entitlementsOf(ownerId)` 由订阅解析；`Quota.planOf` 改为读订阅（已留 seam）。
- Checkout/生命周期：BFF —— 发起 Checkout（→ provider URL）、Webhook 入口（**验签 + 幂等** → created/updated/canceled 更新订阅）、查当前订阅/权益/用量。
- 套餐门禁：跨 BFF 按权益做功能门 + 配额门（按套餐限额）；用量计量（复用 CostLedger）+ 暴露 用量/限额；超限 402 + 升级提示。
- UI 与交付：Billing 页（apps/web）—— 当前套餐 + 用量 + 升级（Checkout）+ 管理/取消；计费安全（验签、幂等、owner 隔离、卡号不落我方、订阅变更落审计）。
- 质量闸门：stub Checkout→active→权益 / Webhook 生命周期幂等+验签 / 套餐门禁（free 触限、pro 不触）/ Billing UI 的测试；文档/Demo。

**不做（留待 Sprint 14+）**
- 真实 Stripe 生产硬化（仅做 fetch 适配器 + 验签 + stub 契约测试，真账号是部署事项，与媒体/搜索适配器同等诚实度）；税务/发票/催款（dunning）/退款/按量计费的复杂 proration。
- 团队/席位管理深度 UI、企业合同计费、多币种/本地化定价。
- OAuth/SSO、Playwright e2e、桌面端（各自专题 Sprint）。

**全程铁律**（违反即返工，见 [AGENTS.md](../AGENTS.md)）：**卡号/支付凭证永不经我方服务器**（一律 provider 托管 Checkout）；**Webhook 必验签 + 幂等**（重放不重复授予/扣减）；订阅按 **owner 隔离**，权益解析失败**默认回落最低套餐 free（fail-closed）**；支付 secret 从 env、不入日志/响应；**禁硬编码套餐限额**（声明式 `config/plans/*.json`）；支付 Provider 是可换挡适配器（Stub 离线默认 / Stripe env 门控），与既有适配器同构；订阅变更落审计；改动集中在 `contracts`/`harness-core`(billing)/`adapters`(payment)/`config`/`apps`/`evals`；每个能力配测试。

---

## 里程碑 A — 支付 Provider + 套餐/权益

### S13-T1 · PaymentProvider 适配器 + 订阅
- **做**：`contracts` 加 `Subscription`（ownerId/plan/status: active|canceled|past_due/periodEnd?/providerRef?）+ `WebhookEvent`（type/ownerId/plan/...）。`harness-core/src/billing/*`：`PaymentProvider` 接口 + `StubPaymentProvider`（createCheckout 返回一个本地"成功"URL/标记，parseWebhook 造 created/canceled 事件）+ `SubscriptionRepository`（内存）。`adapters/payment/stripe`：`StripePaymentProvider`（fetch Stripe API + HMAC-SHA256 验签，env 门控）。
- **DoD**：Stub：createCheckout → 模拟成功 → parseWebhook 产 `subscription.created` → 仓库置 active；cancel → canceled。Stripe 适配器：验签对已知 secret 通过、篡改拒；单测覆盖 stub 全生命周期 + 验签。
- **改动**：`contracts/src/billing.ts`、`harness-core/src/billing/*`、`adapters/payment/stripe`、`db-postgres`（subscriptions 表）。
- **依赖**：Sprint 04 加密 secret 风格、Sprint 10 鉴权。

### S13-T2 · 声明式套餐 + 权益
- **做**：`config/plans/*.json`（free/pro/team：`taskLimit`、`features: string[]`、价格元数据）+ `loadPlans()`。`entitlementsOf(ownerId)`：读订阅 → 套餐 → 权益（限额 + 功能位）；无订阅/解析失败 → free。`Quota.planOf` 接 `entitlementsOf`（plan seam 已存在）。
- **DoD**：默认 free；造一个 active pro 订阅 → 限额/功能升到 pro；订阅 canceled/过期 → 回落 free；新增套餐无需改业务代码。
- **依赖**：S13-T1、既有 `Quota`。

---

## 里程碑 B — Checkout / 生命周期 / 门禁

### S13-T3 · Checkout + 订阅状态 + Webhook
- **做**：BFF —— `POST /api/billing/checkout {plan}` → provider.createCheckout → 返回 url（stub 返回本地"成功"链接）；`POST /api/billing/webhook`（**原始 body 验签** → parseWebhook → 幂等更新 SubscriptionRepository；created/updated/canceled）；`GET /api/billing/subscription`（当前订阅 + 权益 + 用量）。订阅变更落审计。
- **DoD**：stub Checkout → webhook(created) → `GET subscription` 显示 active pro；重复投递同一 webhook 幂等（不重复）；验签失败 401；canceled webhook → 回落 free。
- **依赖**：S13-T1/T2、Sprint 10（鉴权/限流/可观测）。

### S13-T4 · 套餐门禁 + 用量计量
- **做**：跨 BFF 用 `entitlementsOf` 做**功能门**（如 pro-only 功能拒绝 free）+ **配额门**（`Quota` 按套餐限额，沿用既有 402）；用量（CostLedger / 任务计数）对比限额，`GET subscription` 暴露 `usage/limit`；超限 402 + 升级提示。
- **DoD**：free 用户触任务限额 → 402（带 plan/used/limit）；pro 不触；pro-only 功能对 free 拒、对 pro 放行；用量数字准确。
- **依赖**：S13-T2、S13-T3。

---

## 里程碑 C — UI 与计费安全

### S13-T5 · Billing UI（apps/web）
- **做**：`apps/web` 加 **Billing/Plans 页**：当前套餐 + 用量进度 + 套餐对比 + 升级（→ Checkout url）+ 管理/取消。设置页或导航入口。
- **DoD**：浏览器：看当前套餐/用量 → 点升级 → （stub）走通 → 回来显示 pro；取消 → 回 free；组件测试覆盖加载/升级/取消（mock fetch）。
- **依赖**：S13-T3、Sprint 09 前端。

### S13-T6 · 计费安全与完整性
- **做**：Webhook **验签**（Stripe HMAC；stub 用共享密钥）+ **幂等**（按 event id 去重，重放不二次生效）；订阅 **owner 隔离**；**卡号不落我方**（provider 托管 Checkout，我方只存 providerRef + 套餐状态）；支付 secret 不入日志/响应；订阅变更落审计。
- **DoD**：单测：篡改 webhook 拒；重放同 event id 幂等；跨 owner 读订阅拒；日志/响应不含支付 secret；订阅变更有审计。
- **依赖**：S13-T1、S13-T3、Sprint 10 安全。

---

## 里程碑 D — 质量闸门

### S13-T7 · Eval/测试扩展
- **做**：stub Checkout→webhook→active→权益 端到端；Webhook 幂等 + 验签；套餐门禁（free 触限/pro 不触、pro-only 功能）；回落（canceled→free）；Billing UI 组件测试。可加 1 项 eval：套餐权益解析（订阅→限额/功能）。CI 离线确定性（stub provider）。
- **DoD**：`pnpm test` + `pnpm test:web`（+ 如加则 `pnpm eval`）覆盖以上；CI 全门禁绿；故意破坏（验签失效 / webhook 不幂等 / 门禁失效 / 权益不回落）任一即变红。
- **依赖**：S13-T1…T6。

### S13-T8 · 文档回写 + Demo
- **做**：更新 README（套餐/计费：env `STRIPE_*`、Webhook、stub vs Stripe、套餐配置）/ARCHITECTURE（§1 适配器矩阵加 PaymentProvider；计费数据流）/CLAUDE/AGENTS。Demo 端到端（离线 stub 可演示），Sprint 13 DoD 勾选。
- **DoD**：新人按 README 在 stub 模式走通升级/取消；env 文档准确；Demo 离线可演示。
- **依赖**：S13-T1…T7。

---

## 执行顺序与并行建议

```
S13-T1(PaymentProvider+订阅) ─ S13-T2(套餐/权益) ─┬─ S13-T3(Checkout/Webhook)
                                                  └─ ...
                            S13-T3 ─┬─ S13-T4(门禁/用量)
                                    ├─ S13-T5(Billing UI)
                                    └─ S13-T6(计费安全)
                              全部收口 → S13-T7(测试) → S13-T8(Docs)
```
- **关键路径**：S13-T1（Provider + 订阅）→ S13-T2（套餐/权益）→ S13-T3（Checkout/Webhook）是地基；门禁/UI/安全在其上并行。
- **每完成一个任务**：跑该模块测试 + 相关回归；一任务一 PR，CI 绿即合；提交说明写清「动了哪个 provider/端点 + 加了哪个测试」。
- **建议 PR 分组**：A(T1+T2) · B(T3+T4) · C(T5+T6) · D(T7+T8)。

## Sprint 13 Definition of Done（整体验收）
- [x] 支付 Provider：`PaymentProvider`（Stub 离线 / Stripe env 门控 + 验签）+ `Subscription` + 仓库（内存 + Postgres）；卡号不落我方。
- [x] 套餐/权益：声明式 `config/plans/*.json` + `resolveEntitlements`；`Quota` 读订阅；解析失败回落 free。
- [x] Checkout/生命周期：发起 Checkout、Webhook 验签 + 幂等更新、查订阅/权益/用量；订阅变更落审计。
- [x] 门禁：功能门（cowork/media 为 pro）+ 配额门按套餐；超限 402 + 升级提示；用量准确。
- [x] Billing UI：当前套餐/用量/升级/取消走通。
- [x] 安全：验签 + 幂等 + owner 隔离 + 支付 secret 不入日志/响应。
- [x] `pnpm test` + `pnpm test:web` 覆盖生命周期/幂等/验签/门禁/回落/UI；CI 全门禁绿。
- [x] README/架构文档更新；Demo 离线（stub）可演示。

> **Sprint 13 完成**（PR [#76](https://github.com/Timsunzhuping/ApollaAIStudio/pull/76) A · [#77](https://github.com/Timsunzhuping/ApollaAIStudio/pull/77) B · [#78](https://github.com/Timsunzhuping/ApollaAIStudio/pull/78) C · D 本次）。可插拔 **PaymentProvider**（Stub 离线 / Stripe env 门控，fetch-based 无 SDK + 签名验证）+ `Subscription`/`WebhookEvent`/`PlanDef` 契约 + 仓库（内存 + Postgres `subscriptions`/`billing_events`）；声明式套餐 `config/plans/*.json`（free/pro/team）+ `resolveEntitlements`（fail-closed 回落 free）+ `Quota.planOf` 异步读订阅；Checkout（stub 立即激活）+ 公开 Webhook（原始体验签 + 幂等）+ cancel + 订阅/权益/用量端点（订阅变更落审计）；功能门（cowork/media 为 pro）+ 配额门（402 + 升级）；Web Billing 页（套餐/用量/升级/取消）。卡号不落我方。测试：harness-core 8 + bff 5 + web Billing 1；新增 eval `billing-entitlements`（共 36）。全门禁绿。

## 风险与提示（给代理）
- **卡号零接触**：永远用 provider 托管 Checkout；我方只存 providerRef + 订阅状态；绝不收/存/传卡号。
- **Webhook 验签 + 幂等是底线**：用**原始请求体**验 HMAC；按 event id 去重——重放/乱序不得重复授予权益或扣费。
- **权益 fail-closed**：解析不出有效订阅 → free（最低权益），绝不默认放行 pro。
- **支付 Provider 可换挡**：Stub 离线默认（确定性、CI 可跑）、Stripe env 门控；与 LLM/媒体/搜索适配器同构，缺 key 回退 stub。
- **复用底座**：套餐限额接既有 `Quota`/`PricingBook`/`CostLedger`，不另造计量；402 升级提示沿用既有模式。
- **secret 纪律**：`STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` 从 env，不入日志/审计/响应/指标。
- **诚实边界**：真实 Stripe 端到端是部署事项；本 Sprint 测 stub 全生命周期 + 验签逻辑，Stripe 适配器结构与其他 provider 一致，PR 写明。
- **不确定/不可逆**（套餐字段、功能位命名、宽限期、webhook 去重存储）→ 选保守默认并在 PR 标注。
