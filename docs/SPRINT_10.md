# Sprint 10 执行单 — Production Hardening & Security

> 读者：**Codex / Claude Code**。逐任务从上往下执行；每个任务自带验收（DoD）、依赖、改动位置。
> 前置必读：[ARCHITECTURE.md](./ARCHITECTURE.md) §3.8/§9 · [AGENTS.md](../AGENTS.md) · `apps/bff/src/server.ts`（鉴权 + 全部 :id 端点）· Sprint 01–09（已完成）。
> 目标产物（Sprint Demo）：**一个可负责任上线的服务** —— 真实邮箱+密码注册/登录（安全会话），用户 B 无法读/改用户 A 的任何资源（任务/文件/Job/连接器/定时/通知/媒体），昂贵端点限流，安全响应头齐全，结构化请求日志 + `/metrics`，重启后中断的 Job 被对账恢复、优雅停机不丢状态。零配置离线 demo 仍可一键体验。

## 0. Sprint 范围与非目标

**主题**：九个 Sprint 建成了可上线的 To-C 工作台，但鉴权仍是"任意邮箱即登录"——**任何人输入他人邮箱即可冒充**，这是上线前最大的硬伤。本 Sprint 把**周界**硬化到与既有内核安全（Safety 三级 / 数据通道 / 路径隔离 / 不自我确认 / 前端不持密钥）同等水平：真实鉴权 + 多租户隔离 + 限流 + 安全头 + 可观测性 + Job 持久恢复。安全是贯穿主线，本 Sprint 收口"能不能安全地交给真实用户"。

**做（本 Sprint 的闭环）**
- 真实鉴权：邮箱 + 密码注册/登录（密码 **scrypt 哈希**，用 `node:crypto`，不引新依赖）；**签名 httpOnly 会话**（过期 + 轮换），`SessionRepository`（内存 + Postgres）。**生产模式要求密码；零配置 demo 模式保留无密码"以 demo 身份继续"**（明确分离）。
- 多租户隔离审计（防 IDOR）：逐一审计每个取 `:id` 的 BFF 端点（task/job/file/connector/schedule/notification/media/agent…），确保**按 ownerId 校验归属**，跨租户访问一律 404/403；补回归测试（用户 B 取用户 A 的资源被拒）。
- 限流与配额：BFF 层 **per-owner + per-IP 令牌桶**限流（可配），昂贵端点（research/agent/cowork/media/surface）超限 429；与既有 Quota 协同。
- 安全周界：安全响应头（CSP / X-Content-Type-Options / Referrer-Policy / frame-deny）、SPA 源 **CORS 白名单**、JSON body 体积上限、会话 cookie 标志（`HttpOnly`/`Secure`/`SameSite`）。
- 可观测性：结构化请求日志（method/path/status/ownerId/latency/**request-id**，**绝不打印密钥/密码/PII**）、`/metrics`（计数 + 延迟分布，进程内）、request-id 贯穿审计。
- Job 持久恢复 + 优雅停机：启动时对账 Postgres 里残留的 `queued`/`running` Job（恢复或标记 `interrupted`），优雅停机置终态 + 关 SSE；调度器/Job 重启可续。
- 质量闸门：安全回归（IDOR 拒绝 / 限流触发 / 需会话 / 密码校验 / Job 恢复）测试；前端登录改注册/登录；文档。

**不做（留待 Sprint 11+）**
- OAuth / 社交登录 / SSO / 企业 RBAC（超出 owner 级隔离）；多因素认证。
- 真正的分布式队列（Redis/BullMQ）——本 Sprint 的"持久恢复"是 **Postgres 对账**，不引消息中间件。
- WAF/DDoS 基础设施、渗透测试、PII/GDPR 合规工具、真实支付/计费集成、密钥管理服务（KMS）。
- 浏览器扩展 / 桌面端 / SSR 营销站（属各自触点 Sprint）。

**全程铁律**（违反即返工，见 [AGENTS.md](../AGENTS.md)）：**密码只存 scrypt 哈希 + 每用户盐，绝不明文、绝不入日志**；**会话 cookie 必 `HttpOnly`+签名+过期**，密钥从 env（`SESSION_SECRET`）；**每个 `:id` 端点必校验 ownerId**，跨租户默认拒绝（fail-closed）；限流/体积限制在服务端强制（前端不可信）；**日志/指标绝不含密钥/密码/会话令牌/PII**；`/metrics` 与诊断端点不泄露敏感数据；零配置 demo 模式与生产模式清晰分离（demo 不削弱生产默认）；改动集中在 `apps/bff`/`harness-core`（Session/限流/可观测性原语）/`adapters/db`/`apps/web`/`evals`；每个安全能力配回归测试。

---

## 里程碑 A — 真实鉴权与会话

### S10-T1 · 密码鉴权 + 安全会话
- **做**：`contracts` 加 `Session`（id/ownerId/expiresAt）。`harness-core` 加密码哈希工具（`scrypt` + 随机盐 + 定时安全比较）与 `SessionRepository`（内存 + Postgres）。BFF：`POST /api/auth/register {email,password}`、`POST /api/auth/login {email,password}` → 校验 → 签名 httpOnly 会话 cookie（过期 + 登录轮换）；`logout` 失效会话；`me` 读会话。**生产模式（`AUTH_MODE=password` 或 `NODE_ENV=production`）要求密码**；**demo 模式默认允许"以 demo 身份继续"**（无密码，种子用户），二者由 env 切换。
- **DoD**：注册→登录→`me` 走通；错密码被拒；会话过期/登出后 `me` 401；密码以哈希存储（DB 中无明文）；demo 模式仍可零配置登录；单测覆盖哈希校验 + 会话生命周期。
- **改动**：`contracts/src/session.ts`、`harness-core/src/auth/*`、`db-postgres`、`apps/bff`、`apps/web`（登录页加注册/密码）。
- **依赖**：Sprint 02 身份/持久化。

### S10-T2 · 多租户隔离审计（防 IDOR）
- **做**：逐一审计 BFF 中每个取 `:id`/`?id=`/`path=` 的端点，确保解析资源后**校验 `ownerId === 当前用户`**，否则 404/403（fail-closed）。覆盖：tasks（events/export/media/save-as-skill）、jobs（events）、workspace（file/history/rollback/save-artifact）、writer、surface、connectors（toggle/delete）、schedules（toggle/run-now/delete）、notifications（read）、media（events）、agent（confirm/events）、audit。修复任何仅按 id 解析而不校验归属者。
- **DoD**：回归测试：用户 B 持用户 A 的各类 id 调用，全部被拒（不泄露存在性）；既有功能不回归。
- **依赖**：S10-T1。

---

## 里程碑 B — 滥用防护与周界

### S10-T3 · 限流 + 请求配额
- **做**：`harness-core` 加 `RateLimiter`（令牌桶，注入时钟，可配 rate/burst）。BFF 中间件：**per-owner + per-IP** 限流，昂贵端点（research/agent/cowork/media/surface/writer）更严；超限 429 + `Retry-After`；与既有 Quota（计费档）协同、不重复扣减。
- **DoD**：单测：突发超阈值 → 429；窗口恢复后放行；per-owner 与 per-IP 独立；只读端点宽松、写/生成端点严格。
- **依赖**：S10-T1。

### S10-T4 · 安全响应头 + CORS + 体积限制
- **做**：BFF 统一中间件：安全头（`Content-Security-Policy`、`X-Content-Type-Options: nosniff`、`Referrer-Policy`、`X-Frame-Options: DENY`）；**CORS 白名单**（SPA 源，`credentials` 允许）；JSON body 体积上限（拒超大请求 413）；会话 cookie `HttpOnly`+`SameSite=Lax`+（生产）`Secure`。
- **DoD**：响应含安全头；跨源非白名单被拒；超大 body 413；cookie 标志正确；既有前端联调不受影响。
- **依赖**：S10-T1。

---

## 里程碑 C — 可观测性与韧性

### S10-T5 · 结构化日志 + /metrics + request-id
- **做**：`harness-core` 加轻量 `Metrics`（计数器 + 延迟直方图，进程内）与请求日志原语。BFF：每请求生成 **request-id**，结构化日志（method/path/status/ownerId/latency/request-id，**脱敏**）；`GET /metrics`（请求数/状态分布/延迟/Job 计数）；request-id 写入审计与 SSE。
- **DoD**：请求产生一行结构化日志（无敏感字段）；`/metrics` 返回累计指标；request-id 可在日志↔审计间关联；单测覆盖 Metrics + 脱敏。
- **依赖**：S10-T1。

### S10-T6 · Job 持久恢复 + 优雅停机
- **做**：启动时 `reconcileJobs()`：扫描 Postgres 中非终态 Job（`queued`/`running`）——可安全续跑的恢复，否则标 `interrupted`（终态）+ 通知；调度器按 `nextRunAt` 续。优雅停机（SIGTERM）：停止接收、置在跑 Job 终态/可恢复、关闭 SSE 与连接池。
- **DoD**：模拟"残留 running Job" → 启动后被对账为终态/恢复，不永久卡住；SIGTERM 后无悬挂连接；单测覆盖对账逻辑（注入残留 Job）。
- **依赖**：Sprint 05 Job/Scheduler。

---

## 里程碑 D — 质量闸门

### S10-T7 · 安全回归测试 + 前端鉴权
- **做**：扩测试/eval：①需会话（未登录访问受保护端点 401）②IDOR 拒绝（跨租户）③限流 429 ④密码校验 + 会话过期 ⑤Job 恢复对账。前端登录页支持注册/登录（密码），demo 模式"以 demo 身份继续"。CI 离线确定性（注入时钟/种子）。
- **DoD**：`pnpm test`（+ `pnpm test:web`）覆盖以上；CI 全门禁绿；故意破坏（漏 owner 校验 / 不限流 / 残留 Job 卡死）任一即变红。
- **依赖**：S10-T1…T6。

### S10-T8 · 文档回写 + Demo
- **做**：更新 README（鉴权/env：`SESSION_SECRET`/`AUTH_MODE`/`CORS_ORIGIN`/限流配置；生产 vs demo 模式）/ARCHITECTURE（§3.8 安全周界、§9 部署/可观测性）/CLAUDE/AGENTS。Demo 端到端（离线可演示），Sprint 10 DoD 勾选。
- **DoD**：新人按 README 起本地（demo 一键 + 生产模式说明）；env 文档准确；Demo 走通。
- **依赖**：S10-T1…T7。

---

## 执行顺序与并行建议

```
S10-T1(鉴权+会话) ─ S10-T2(隔离审计) ─┬─ S10-T3(限流)
                                       ├─ S10-T4(安全头/CORS)
                                       ├─ S10-T5(可观测性)
                                       └─ S10-T6(Job 恢复/停机)
                              全部收口 → S10-T7(安全回归+前端) → S10-T8(Docs)
```
- **关键路径**：S10-T1（会话/身份）是地基；T2 隔离审计紧随；T3–T6 周界/韧性并行。
- **每完成一个任务**：跑该模块单测 + 相关回归；一任务一 PR，CI 绿即合；提交说明写清「动了哪个中间件/端点 + 加了哪个回归」。
- **建议 PR 分组**：A(T1+T2) · B(T3+T4) · C(T5+T6) · D(T7+T8)。

## Sprint 10 Definition of Done（整体验收）
- [x] 真实鉴权：邮箱+密码注册/登录，scrypt 哈希（DB 无明文），签名 httpOnly 会话（过期+轮换+登出失效）；生产模式要求密码，demo 模式保留零配置登录。
- [x] 多租户隔离：每个 `:id`/path 端点校验 ownerId，跨租户 fail-closed；回归测试拒绝跨租户访问（修复 4 处 IDOR）。
- [x] 限流：per-owner + per-IP 令牌桶，昂贵端点更严，超限 429 + Retry-After。
- [x] 周界：安全响应头 + CORS 白名单 + body 体积上限 + 安全 cookie 标志。
- [x] 可观测性：脱敏结构化请求日志 + request-id + `/metrics`（无敏感数据）。
- [x] 韧性：启动对账非终态 Job（标 interrupted）、优雅停机不丢状态。
- [x] 测试：会话必需/IDOR/限流/密码/Job 恢复回归；`pnpm test` + `pnpm test:web` + CI 全门禁绿。
- [x] README/架构文档更新（env + 生产/demo 模式）；Demo 离线可演示。

> **Sprint 10 完成。** S10-T1–T8 全部合并到 main（PR #61–#63 + 本 PR）。安全周界落地：真实鉴权（scrypt + 服务端会话）、多租户隔离（修复 4 处 IDOR，fail-closed）、限流（per-IP + per-owner 429）、安全头/CORS/body 上限、`/metrics` + request-id + 脱敏日志、Job 启动对账 + 优雅停机。回归测试覆盖会话必需/IDOR（schedule/job/workspace）/限流/密码/会话过期/Job 恢复；root 222 + web 16 测试，eval 34，CI 全门禁绿。demo 模式仍零配置。

## 风险与提示（给代理）
- **fail-closed 是默认**：拿不准归属就拒；跨租户访问宁可 404，不泄露资源是否存在。
- **密码/会话纪律**：scrypt + 每用户盐 + 定时安全比较；cookie 签名 + HttpOnly + 过期；**任何日志/指标/错误响应都不得含密码/会话令牌/密钥**。
- **demo 不削弱生产**：零配置 demo 的便利只在 demo 模式开启；生产模式默认安全（要密码、Secure cookie、CORS 白名单），由 env 明确切换。
- **限流要服务端强制**：前端可被绕过；限流/体积限制只信服务端；与既有 Quota 协同别双扣。
- **恢复语义保守**：残留 Job 能确定可安全续跑才续，否则标 `interrupted`（终态）+ 通知，绝不让用户永远卡在 running。
- **不引中间件依赖**：哈希用 `node:crypto`，限流/指标/会话用进程内原语（注入时钟可测）；分布式队列/KMS 留待后续。
- **不确定/不可逆**（会话时长默认、限流阈值、CSP 严格度）→ 选保守安全默认并在 PR 标注。
