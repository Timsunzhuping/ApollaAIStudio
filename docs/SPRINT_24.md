# Sprint 24 执行单 — 1.0 Release & Hardening（发布加固与收尾）

> 读者：**Codex / Claude Code**。逐任务执行；每任务自带 DoD/依赖/改动位置。
> 前置必读：[ARCHITECTURE.md](./ARCHITECTURE.md) · [AGENTS.md](../AGENTS.md) · [DEPLOY.md](./DEPLOY.md) · `apps/bff/src/server.ts`（bootstrap/health/headers）· `apps/bff/src/auth.ts`（`SESSION_SECRET`）· Sprint 10（安全基线）· Sprint 15（发布/单源 e2e）。
> 目标产物（Sprint Demo）：**项目达到 1.0——生产启动会对错误配置 fail-fast（缺 `SESSION_SECRET` 直接拒绝启动,而非用不安全默认值）;`/api/version` 暴露版本与构建信息,`/api/ready` 给负载均衡做就绪探针;前端显示版本;仓库有 `CHANGELOG.md`(01→24 全史)、`SECURITY.md`(威胁模型 + 铁律汇总)、`RELEASE_NOTES.md`,版本号统一升到 `1.0.0`。** 这是发布收尾 Sprint:不加新业务功能,只把已有系统加固、固化、文档化到可发布。

## 0. 范围与非目标

**主题**：产品功能已闭环(S01–S23)。本 Sprint 做**发布加固**——堵住生产部署的脚枪(不安全默认配置)、补齐运维探针(version/ready)、固化发布资产(CHANGELOG/SECURITY/RELEASE_NOTES)、升版本到 1.0,并最终**宣告 1.0 完成**。

**做**：① 启动配置校验 `validateConfig`(生产缺 `SESSION_SECRET`/用 dev 默认值 → **fail-fast 拒绝启动**,并产出 warnings 列表:stub 提供方、内存 DB 等);② 版本单源 + `GET /api/version`(版本/模式/构建)+ health 含 version;③ 就绪探针 `GET /api/ready`(PG 模式探活 DB);④ 前端页脚显示版本;⑤ `CHANGELOG.md`(逐 Sprint 史 → 1.0)+ `SECURITY.md`(威胁模型 + 铁律汇总 + 上报渠道)+ 版本号统一 `1.0.0`;⑥ 发布就绪 eval(配置校验不变量)+ `RELEASE_NOTES.md` + README → 1.0 + **宣告完成**;⑦ 测试;⑧ 文档。

**不做**：新业务功能、新适配器、性能压测/调优大改、CI/CD 流水线重构、容器镜像发布、多区域部署、SLO 告警接入(探针就位即可)。

**全程铁律**：**加固不改变既有行为/默认离线体验**(dev/demo 仍零配置可跑,校验只在 `NODE_ENV=production` 收紧);**生产 fail-fast 优于不安全默认**(缺密钥拒启动,绝不静默用 dev 默认签名会话);版本单源(不散落硬编码);探针**不泄露内部细节/密钥**(version 只回版本/模式,不回连接串/密钥);`SECURITY.md` 不得包含真实密钥/内部主机;离线 hermetic(校验是纯函数 + 注入 env);改动集中在 `apps/bff`(config/version/server)/`apps/web`/根与各 `package.json`(版本)/`docs`/`evals`/根 `CHANGELOG.md`·`SECURITY.md`·`RELEASE_NOTES.md`;每能力配测试。

---

## A — 启动加固 + 版本

### S24-T1 · 启动配置校验（生产 fail-fast）
- **做**：`apps/bff/src/config.ts`：`validateConfig(env)` → `{ errors: string[], warnings: string[] }`。生产(`NODE_ENV=production` 或 `AUTH_MODE=password`)**errors**:缺 `SESSION_SECRET` 或等于 dev 默认值;(可选)用了连接器密钥却缺 `SECRETS_KEY`。**warnings**:内存 DB(无 `DATABASE_URL`)、stub 提供方(无 LLM key)、无 `ADMIN_EMAILS`。bootstrap(`!VITEST` 分支)调用:有 errors → 打印 + `process.exit(1)`;warnings → 打印继续。worker 同样校验。
- **DoD**：生产缺 `SESSION_SECRET` → 进程拒启动(退出码 1);dev 无 env → 0 errors(仅 warnings);纯函数单测覆盖各分支。
- **改动**：`apps/bff/src/config.ts`、`server.ts`(bootstrap)、`workers/job-worker`。

### S24-T2 · 版本单源 + /api/version
- **做**：`apps/bff/src/version.ts`(从根/包 version 读 + `APP_VERSION`/`GIT_SHA` env 覆盖);`GET /api/version`(public:`{ version, mode, persistence, commit? }`,**不含密钥/连接串**);health 加 `version`。
- **DoD**：`/api/version` 回版本 + 模式;不泄敏感;health 含 version。

---

## B — 就绪探针 + 前端版本

### S24-T3 · 就绪探针 /api/ready
- **做**：`GET /api/ready`：PG 模式 `SELECT 1` 探活(成功 200 `{ready:true}`,失败 503 `{ready:false}`);内存模式直接 200。供 LB/k8s readiness。
- **DoD**：就绪 200、DB 不可达 503;不泄内部错误细节(只 ready 布尔 + 通用消息)。

### S24-T4 · 前端版本展示
- **做**：Shell 页脚/顶栏显示 `api.version()` 的版本 + 模式(badge);失败静默。
- **DoD**：渲染版本;组件测试(mock)。

---

## C — 发布资产 + 升版本

### S24-T5 · CHANGELOG.md
- **做**：`CHANGELOG.md`：逐 Sprint(01→24)一行能力摘要 + PR 范围,顶部 `## 1.0.0`。遵循 Keep a Changelog 风格。
- **DoD**：覆盖全部 24 个 Sprint;链接 PR/Sprint 文档。

### S24-T6 · SECURITY.md + 版本 1.0.0
- **做**：`SECURITY.md`:威胁模型概述 + 各域铁律汇总(owner 隔离/secret/会话/MFA/远程数据 untrusted/计费/OAuth/admin/数据生命周期)+ 上报渠道(占位)。根与各 `package.json` `version` → `1.0.0`(脚本批量改 + 校验)。**不含真实密钥/内部主机**。
- **DoD**：SECURITY.md 完整;`grep '"version": "1.0.0"'` 覆盖根 + apps;无敏感泄露。

---

## D — 闸门 + 宣告

### S24-T7 · 发布就绪 Eval/测试
- **做**：`validateConfig` 单测(生产缺 secret→error、dev→无 error、warnings 正确);`/api/version`·`/api/ready` 集成测试(不泄敏感);eval `release-readiness`(配置校验 fail-fast 不变量,离线);Web 版本展示组件测试。
- **DoD**：`pnpm test`+`test:web`+`e2e`+`eval` 全绿;破坏(生产缺 secret 仍启动/version 泄密钥/ready 不探活)任一即红。

### S24-T8 · 文档 + 1.0 宣告
- **做**：`RELEASE_NOTES.md`(1.0 亮点)；README 顶部标注 **v1.0**;DEPLOY 加 version/ready 探针;ARCHITECTURE/AGENTS 注明 1.0 加固;SPRINT_24 DoD 勾选 + 完成 blockquote;README 加"项目已达 1.0"说明。
- **DoD**：文档自洽;1.0 宣告就位。

## Sprint 24 DoD
- [x] `validateConfig` 生产 fail-fast(缺 `SESSION_SECRET` 拒启动)+ warnings。
- [x] 版本单源 + `/api/version` + health.version(不泄敏感)。
- [x] `/api/ready` 就绪探针(PG 探活)。
- [x] 前端版本展示。
- [x] `CHANGELOG.md` + `SECURITY.md` + `RELEASE_NOTES.md` + 版本 `1.0.0`。
- [x] `pnpm test`+`test:web`+`e2e`+`eval` 全绿 hermetic。
- [x] 文档 + 1.0 宣告。

> **Sprint 24 完成 —— 项目达到 1.0**（PR [#131](https://github.com/Timsunzhuping/ApollaAIStudio/pull/131) A · [#132](https://github.com/Timsunzhuping/ApollaAIStudio/pull/132) B · [#133](https://github.com/Timsunzhuping/ApollaAIStudio/pull/133) C · D 本次）。发布加固:`validateConfig`(生产缺/默认 `SESSION_SECRET` → `enforceConfigOrExit` 退出码 1 拒启动;真生产缺 `DATABASE_URL` 拒启动;warnings 提示降级模式)接入 BFF + worker 启动;`version.ts` 单源 + `GET /api/version`(版本/模式,无密钥)+ `GET /api/ready`(`harness.ping`→`SELECT 1`,503 on fail)+ health.version;前端侧栏版本徽标;`CHANGELOG.md`(01→24)+ `SECURITY.md`(威胁模型 + 各域铁律汇总)+ `RELEASE_NOTES.md`;22 个 package.json 版本 → `1.0.0`。新增 eval `release-readiness`(46 total)。341 root + 32 web + 9 e2e 绿。`DATABASE_URL` 错误仅在真生产触发,故 hermetic e2e(password 模式 + 内存)仍可启动。**后续(post-1.0)**:WebAuthn/passkeys、流式语音、完整 MV3 浏览器 e2e、桌面宿主。

## 风险与提示
- **别破坏离线体验**：校验只在生产收紧;dev/demo/e2e 仍零配置(e2e 跑内存模式,validateConfig 在非生产返回 0 errors)。
- **fail-fast 要清晰**：错误信息直指缺哪个 env + 怎么修;退出码 1。
- **探针不泄密**：version/ready 只回版本/布尔 + 通用消息,绝不回连接串/密钥/堆栈。
- **版本单源**：一处定义,api 与前端都读它;批量改 package.json 后跑全套门确认无回归。
- **SECURITY.md**:汇总既有铁律即可,**不要**写入任何真实密钥/内部主机/客户数据。
