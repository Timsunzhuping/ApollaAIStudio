# Sprint 22 执行单 — Account & Data Lifecycle：导出 / 删除 / 导入

> 读者：**Codex / Claude Code**。逐任务从上往下执行；每任务自带 DoD/依赖/改动位置。
> 前置必读：[ARCHITECTURE.md](./ARCHITECTURE.md) · [AGENTS.md](../AGENTS.md)（owner 隔离 + secret 纪律）· `apps/bff/src/harness.ts`（所有 owner-keyed 仓库 + PG `sql` 句柄 + `close`）· `apps/bff/src/auth.ts`（会话）· Sprint 10（owner 隔离/审计）· Sprint 11/20（secret 加密/哈希）。
> 目标产物（Sprint Demo）：**设置页"你的数据"——一键**导出**全部个人数据为 JSON（脱敏，不含密钥）；一键**删除账号**（二次确认 → 级联清除全部 owner-keyed 数据 + 注销会话，不可逆）；**导入**一个导出包恢复数据（归到当前用户名下）。** 全程 owner-scoped、审计；secret 绝不导出/导入。

## 0. 范围与非目标

**主题**：产品已功能齐备，但缺一个成熟 To-C 产品的**数据权利**闭环——用户能带走、删除、迁移自己的数据。本 Sprint 补齐：**导出**（GDPR 式数据可携）、**删除账号**（被遗忘权，级联）、**导入**（恢复/迁移）。建立在既有 owner-keyed 仓库之上,纯聚合/级联,确定性可离线测。

**做**：① 导出聚合器（跨所有 owner-keyed 仓库收集 → 单个 `AccountBundle` JSON,**脱敏**：不含密码哈希/TOTP secret/token secret/连接器密钥）+ 契约;② 删除级联（`purgeOwner` 清除全部 owner-keyed 数据 + 注销会话,不可逆);③ BFF `GET /api/account/export` / `POST /api/account/delete`（二次确认）/ `POST /api/account/import`（恢复包,归到当前用户);④ 安全（导出脱敏、删除需确认、导入 owner-scoped 不可越权、全审计);⑤ 设置页"你的数据"UI（导出下载 / 导入 / 删除危险区);⑥ 测试 + 文档。

**不做**：跨实例迁移协议、增量/定时备份、加密导出包、团队/组织数据迁移、导出真实媒体二进制（仅元数据 + 工作区文本）、删除的延迟宽限/可撤销窗口（本 Sprint 即时不可逆 + 二次确认)。

**全程铁律**：导出/删除/导入**严格 owner-scoped**（只碰当前用户数据,跨租户 fail-closed）；**secret 绝不导出**（密码哈希、TOTP secret、API token 哈希、连接器密钥、魔法链接 token 一律不入导出包）;**删除需显式确认**（再输邮箱/密码）+ **级联清除全部 owner-keyed 表** + **注销所有会话**,不可逆;**导入归到当前用户**（重写 ownerId,绝不冒充/越权,不导入 secret/不提权）;全部落审计;复用既有仓库/会话/owner 检查;离线 hermetic;改动集中在 `contracts`/`harness-core`(account)/`apps/bff`/`apps/web`/`db-postgres`/`docs`/`evals`;每能力配测试。

---

## A — 导出聚合 + 删除级联

### S22-T1 · 导出聚合器 + 契约
- **做**：`harness-core/src/account/export.ts`：`buildAccountBundle(ownerId, repos)` 跨 projects/skills/tasks/media/connectors(脱敏 secret)/jobs/schedules/notifications/plugins/workspace/memory/subscriptions/identities 聚合 → `AccountBundle`（`contracts`）。明确**剔除** secret（连接器密钥置空、不含密码/TOTP/token）。
- **DoD**：bundle 含该用户各类数据；含 `version` + `exportedAt`;**无任何 secret 字段**(测试断言);跨用户不混入。
- **改动**：`harness-core/src/account/*`、`contracts/src/account.ts`。

### S22-T2 · 删除级联
- **做**：`purgeOwner(ownerId)`：PG 模式在事务里 `DELETE … WHERE owner_id=$1` 跨全部 owner-keyed 表;并注销该用户全部会话。harness 暴露 `purgeOwner`(PG 时设置)。
- **DoD**：删除后该用户在各表无残留;会话失效;不影响他人数据。
- **改动**：`apps/bff/src/harness.ts`(purgeOwner via sql)。

---

## B — 端点 + 安全

### S22-T3 · 导出 + 删除端点
- **做**：`GET /api/account/export`（→ 下载 `AccountBundle` JSON,脱敏);`POST /api/account/delete {confirm}`（确认=再输邮箱或密码 → `purgeOwner` + 注销会话 + 审计;不可逆)。
- **DoD**：导出返回完整脱敏包;删除需正确确认(错误 → 401),成功后会话失效、数据没了;落审计。

### S22-T4 · 导入端点 + 安全
- **做**：`POST /api/account/import {bundle}`：zod 校验 → **重写所有 ownerId 为当前用户** → 写入各仓库(跳过 secret/不提权);幂等/冲突按 upsert;审计。
- **DoD**：导入他人导出的包 → 数据归到当前用户(绝不冒充原 owner);非法包 400;不导入任何 secret/权限。

---

## C — Web UI

### S22-T5 · 设置页"你的数据"（导出 + 删除）
- **做**：设置页"你的数据"卡片：**导出**(下载 JSON);**危险区**删除账号(二次确认输邮箱 → 删除 → 登出)。
- **DoD**：浏览器导出得文件;删除走确认 → 登出;组件测试(mock fetch)。

### S22-T6 · 导入 UI + 确认流
- **做**：导入控件(选 JSON 文件 → 预览条目数 → 确认导入 → 提示完成);删除二次确认流完善。
- **DoD**：浏览器导入文件 → 数据恢复;组件测试。

---

## D — 闸门

### S22-T7 · Eval/测试
- **做**：导出脱敏(无 secret)+ owner-scoped;删除级联(各表清空 + 会话失效)+ 需确认;导入重写 owner + 不导 secret/不提权;往返(导出→删除→导入恢复);Web 组件;eval(导出脱敏 + 导入重写 owner)。hermetic。
- **DoD**：`pnpm test`+`test:web`+`e2e` 全绿;破坏(导出含 secret/删除不级联/导入可冒充/跨租户)任一即红。

### S22-T8 · 文档
- **做**：README/ARCHITECTURE(数据生命周期 + 安全语义)/CLAUDE/AGENTS(数据铁律)/DoD 勾选。

## Sprint 22 DoD
- [x] 导出聚合器 + `AccountBundle` 契约(脱敏,无 secret)。
- [x] 删除级联 `purgeOwner`(全表 + 会话,不可逆)。
- [x] 导出/删除/导入端点,owner-scoped + 确认 + 审计。
- [x] 导入重写 ownerId 为当前用户,不导 secret/不提权。
- [x] 设置页导出/导入/删除 UI。
- [x] `pnpm test`+`test:web`+`e2e` 全绿 hermetic。
- [x] 文档更新。

> **Sprint 22 完成**（PR [#121](https://github.com/Timsunzhuping/ApollaAIStudio/pull/121) A · [#122](https://github.com/Timsunzhuping/ApollaAIStudio/pull/122) B · [#123](https://github.com/Timsunzhuping/ApollaAIStudio/pull/123) C · D 本次）。数据权利闭环:**导出** `buildAccountBundle` 跨 owner-keyed 仓库聚合(项目/技能/工作区含内容/计划/通知/插件/连接器/任务/用户模型),连接器密钥置空、密码/TOTP/token 不读不导;**删除** `harness.purgeOwner` 单事务级联清全部 owner-keyed 表 + 身份表 + users 行,`POST /api/account/delete` 需再输邮箱确认 → purge + 注销会话(不可逆,仅 PG);**导入** `importBundle` 重写 ownerId 为当前用户 + 新建 id(项目/技能/工作区/用户模型),绝不冒充原 owner、不导 secret/计划。端点 `GET /api/account/export`(附件)/`POST /api/account/import`(zod)owner-scoped + 审计。设置页"你的数据"(导出下载 / 导入 / 删除危险区)。新增 eval `account-data-lifecycle`(44 total)。329 root + 30 web + 9 e2e 绿。加密导出包 / 团队迁移 / 删除宽限窗口列为后续。

## 风险与提示
- **secret 零导出**：导出包过白名单/剔除 secret(连接器密钥、密码哈希、TOTP、token);测试断言无 secret。
- **删除不可逆 + 需确认**：再输邮箱/密码;级联清全部 owner-keyed 表 + 注销会话;PG 用事务。
- **导入不可冒充**：一律重写 ownerId 为当前用户,绝不按包里的 ownerId 写;不导入 secret/权限/订阅状态(避免白嫖 pro)。
- **owner-scoped**：三者只碰当前用户数据;跨租户 fail-closed。
- **不确定**(导出包版本、删除确认方式、导入冲突策略、是否导订阅) → 选保守默认并 PR 标注。
