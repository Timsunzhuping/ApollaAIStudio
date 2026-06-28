# Sprint 23 执行单 — Admin & Operations Console（运营/管理控制台）

> 读者：**Codex / Claude Code**。逐任务执行；每任务自带 DoD/依赖/改动位置。
> 前置必读：[ARCHITECTURE.md](./ARCHITECTURE.md) · [AGENTS.md](../AGENTS.md)（owner 隔离 + 审计）· `apps/bff/src/harness.ts`（PG `sql` 句柄 + 所有仓库）· `apps/bff/src/server.ts`（鉴权门 + owner-scoped 区）· Sprint 10（owner 隔离/审计/限流）· Sprint 13（订阅/计划/entitlements）· Sprint 16/17（job 队列/可观测）。
> 目标产物（Sprint Demo）：**一个 owner（管理员）能进入"运营台"——看到全站运营指标（用户/项目/任务/job 状态/订阅分布）、最近审计流、用户列表（仅元数据 + 计划），并能为某用户授予/变更计划（客服/运营用）。** 管理员身份由**可信来源**（`ADMIN_EMAILS` 环境变量）判定,非管理员一律 **403 fail-closed**;管理员只看**聚合 + 元数据**,绝不看他人**私有内容**(工作区文件/研究正文);每个管理动作**落审计**(记录操作管理员)。

## 0. 范围与非目标

**主题**：产品功能闭环已成,但运营一个已部署的 To-C 产品还缺一个**运营/管理面**——查健康度、看增长、做客服支持。本 Sprint 补齐一个**只读为主、最小可用**的运营台。

**做**：① 管理员鉴权(`ADMIN_EMAILS` 环境变量判定 + `requireAdmin` 门,fail-closed) + 全站统计聚合(用户/项目/任务/job 各状态/订阅各计划计数);② 跨 owner 审计读取 + job/队列健康聚合;③ 管理端点 `GET /api/admin/stats` / `/api/admin/audit` / `/api/admin/users` / `/api/admin/users/:id`;④ 一个运营动作 `POST /api/admin/users/:id/plan`(授予/变更计划) + 安全(fail-closed、不泄私有内容、不可自我提权);⑤ Web 运营台页(仅管理员可见的导航 + 仪表盘 + 审计流 + 用户搜索/授计划);⑥ 测试 + 文档。

**不做**：RBAC/细粒度角色体系(仅"是否管理员"二元)、封禁/删除他人账号(运营删号风险大,留后续)、查看/编辑他人私有内容、计费退款操作、多租户组织管理、实时大盘推送(本 Sprint 拉取式)。

**全程铁律**：**管理员身份来自可信来源**(`ADMIN_EMAILS` 环境变量,非客户端声明、无 DB 列 → **不可自我提权**);所有 `/api/admin/*` **非管理员 403 fail-closed**;管理员只读**聚合 + 元数据**,**绝不返回他人私有内容**(工作区正文/研究结果/连接器密钥/token);每个管理**动作**落审计(含操作管理员 id + 目标);限流;`setUserPlan` 复用既有 `SubscriptionRepository`(不旁路 entitlements);全站聚合查询仅 Postgres(`harness.admin?`,无 DB → 端点 503,与 `purgeOwner` 同范式);Web 运营台仅在 `me.isAdmin` 时显示;离线 hermetic(bff 测试跑 PG);改动集中在 `contracts`/`apps/bff`(admin 服务 + 端点)/`apps/web`/`docs`/`evals`。

---

## A — 管理员鉴权 + 聚合

### S23-T1 · 管理员鉴权 + 全站统计
- **做**：`isAdmin(email)`(读 `ADMIN_EMAILS` 逗号分隔白名单);server.ts 在鉴权门后取当前用户 email → 标记 `isAdmin`;`requireAdmin`→ 非管理员 403。`me` 返回 `isAdmin`。`AdminStats` 契约 + PG 聚合(COUNT users/projects/tasks、jobs 按 status、subscriptions 按 plan)。
- **DoD**：管理员可过门、非管理员 403;stats 返回各计数;无 DB → 端点 503。
- **改动**：`apps/bff/src/admin.ts`(服务)、`contracts/src/admin.ts`、`server.ts`、`harness.ts`(`admin?`)。

### S23-T2 · 跨 owner 审计 + 用户列表聚合
- **做**：admin 服务加 `recentAudit(limit)`(全站 `audit_log` 倒序)、`users(limit)`(id/email/createdAt/plan/项目数,仅元数据)、`userDetail(id)`(元数据 + 计划 + 用量,**无私有内容**)。
- **DoD**：返回元数据;断言**不含**工作区正文/研究结果/密钥。

---

## B — 端点 + 运营动作

### S23-T3 · 管理只读端点
- **做**：`GET /api/admin/stats` / `/api/admin/audit?limit` / `/api/admin/users?limit` / `/api/admin/users/:id`,全部 `requireAdmin` + 限流。
- **DoD**：管理员得数据、非管理员 403;不泄私有内容。

### S23-T4 · 运营动作:授予计划 + 安全
- **做**：`POST /api/admin/users/:id/plan {plan}`:校验 plan ∈ 已配置计划 → `SubscriptionRepository.save` 该用户 → entitlements 生效;审计(操作管理员 + 目标用户 + 计划)。
- **DoD**：授 pro 后该用户 entitlements=pro;非法 plan 400;非管理员 403;自我提权不可能(管理员身份来自 env)。

---

## C — Web 运营台

### S23-T5 · 运营台页 + 仪表盘
- **做**：`/admin` 路由 + 导航项(**仅 `me.isAdmin` 显示**);仪表盘卡片(用户/项目/任务/job 状态/订阅分布)+ 队列/健康。
- **DoD**：管理员看到仪表盘;非管理员无导航项 + 直访被后端 403;组件测试。

### S23-T6 · 审计流 + 用户管理 UI
- **做**：审计流表;用户列表 + 搜索 + 授计划控件(下拉选 plan → 提交 → 提示)。
- **DoD**：列表/审计渲染;授计划调用端点;组件测试。

---

## D — 闸门

### S23-T7 · Eval/测试
- **做**：鉴权(管理员过/非管理员 403)、stats 计数、审计不含私有内容、授计划改 entitlements、自我提权不可能;Web 组件(管理员见面板/非管理员不见);eval(admin 鉴权 fail-closed + 不泄私有内容)。hermetic。
- **DoD**：`pnpm test`+`test:web`+`e2e` 全绿;破坏(非管理员可读/泄私有内容/客户端可声明 admin/可自我提权)任一即红。

### S23-T8 · 文档
- **做**：README/ARCHITECTURE(运营台 + 鉴权语义)/CLAUDE/AGENTS(管理铁律)/DEPLOY(`ADMIN_EMAILS`)/DoD 勾选。

## Sprint 23 DoD
- [ ] 管理员鉴权(`ADMIN_EMAILS` 可信来源,fail-closed)+ `me.isAdmin`。
- [ ] 全站统计 + 跨 owner 审计 + 用户元数据聚合(无私有内容)。
- [ ] 管理只读端点 + 授计划动作,requireAdmin + 限流 + 审计。
- [ ] Web 运营台(仅管理员)+ 仪表盘 + 审计流 + 用户管理。
- [ ] `pnpm test`+`test:web`+`e2e` 全绿 hermetic。
- [ ] 文档更新。

## 风险与提示
- **不可自我提权**：管理员身份只来自 `ADMIN_EMAILS` 环境变量,绝不读客户端字段、绝不加可被用户改写的 DB 列。
- **不泄私有内容**：admin 聚合只回元数据 + 计数 + 审计摘要;**绝不**回工作区正文/研究结果/连接器密钥/token;测试断言。
- **fail-closed**：`/api/admin/*` 默认拒,仅白名单 email 放行;限流 + 审计。
- **PG-only**：全站聚合用 `sql`(`harness.admin?`),无 DB → 503;bff 测试跑 PG。
- **复用**：授计划走 `SubscriptionRepository`(entitlements 不旁路);审计走既有 `audit`。
