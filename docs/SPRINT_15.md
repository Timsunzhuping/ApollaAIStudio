# Sprint 15 执行单 — End-to-End Tests & Release Readiness：Playwright 真实浏览器端到端

> 读者：**Codex / Claude Code**。逐任务从上往下执行；每个任务自带验收（DoD）、依赖、改动位置。
> 前置必读：[ARCHITECTURE.md](./ARCHITECTURE.md)（测试金字塔 / evals-as-the-net）· [AGENTS.md](../AGENTS.md)（安全周界 + 离线确定性）· `apps/web`（Vite+React SPA，`BASE=VITE_API_BASE ?? ''` 同源、`credentials:'include'`）· `apps/bff/src/server.ts`（`{handle,setHarness}`，目前 `/` 只发内联 `UI_HTML`，**未**托管 web SPA）· Sprint 09–14（前端 / 安全 / 计费 / 身份均已落地，但两套 UI 至今**只有 mock fetch 的组件测试**）。
> 目标产物（Sprint Demo）：**`pnpm e2e` —— 真实 Chromium 跑通注册/登录/SSO → 提研究→SSE 流式出结果 → 升级套餐→pro 权益→取消 等核心旅程，全程跑真实"构建后的 web → 真实 BFF（HTTP/SSE）"整合栈，完全离线确定性（内存 BFF + 全 stub provider，CI 不出网），并接入 CI 作为必过门禁。**

## 0. Sprint 范围与非目标

**主题**：十四个 Sprint 把后端、安全、计费、身份、两套 UI 都做齐了——**但整合栈零 e2e 覆盖**。`apps/web` / `apps/extension` 的全部前端测试都 mock 了 `fetch`，从没有一个测试真正在浏览器里跑「构建后的前端 → 真实 BFF → 真实 SSE/会话 cookie/路由」。组件测试证明组件渲染对，证明不了**产品真的能用**（SPA 路由、真实 SSE 流、登录 cookie 全链路、BFF 静态托管前端、CORS/同源、生产构建可部署）。本 Sprint 补上这张**整合网**：用 **Playwright** 真实浏览器端到端，并顺带把"BFF 单源托管 SPA"这块**真正可部署**的缺口补齐。e2e 是 evals（能力网）之外的**整合网**。

**做（本 Sprint 的闭环）**
- E2E 框架：新 `e2e/`（@apolla/e2e）+ Playwright（chromium）；fixture 启动**内存模式 BFF**（无 `DATABASE_URL` → 内存仓库，天然 hermetic）+ 全 stub provider（Mock LLM / StubSearch / StubMedia / StubOAuth / StubPayment），**单源**托管构建后的 web dist，临时端口；全局 setup/teardown；冒烟用例（应用加载、登录页出现）。
- BFF 单源托管 SPA：BFF 可服务 `apps/web/dist`（带 SPA fallback 到 `index.html`），env 门控（`WEB_DIST` 或自动探测）。**单源 → 会话 cookie 天然生效**（免跨源 cookie/CORS 折腾），且更贴近生产部署。
- 核心旅程 e2e（真实栈，非 mock）：① 鉴权（注册→工作台；登出→登录；**Stub SSO** 点「Demo SSO」走 start/callback→已登录；鉴权门拦截）；② 研究（提问→**真实 SSE 流式**渲染→答案+引用出现→导出链接）；③ 计费 + 套餐门禁（升级→stub Checkout 激活→Billing 显示 Pro+用量→取消回落 free；free 用户触发 pro 功能见升级提示）；④ 工作区/Surfaces（跑一个 Surface 或存产物→工作区出现→版本历史）。
- 发布就绪：**生产构建模式** e2e（跑构建产物 + 生产化 env，验证旅程在 prod 配置下通）；`docs/DEPLOY.md` 部署 runbook（单源部署、env 清单、健康检查）；确保 `pnpm build` 产出可部署。
- CI 接入与稳定性：CI 加 `e2e` job（装 chromium、build web、headless 跑 Playwright）；失败留 trace/截图工件；有界超时、确定性 stub、无网络；作为必过门禁，且不显著拖慢。
- 文档：README（如何本地跑 e2e、覆盖什么、离线确定性）/ARCHITECTURE（测试金字塔：单元/契约 → web 组件 → e2e 整合网）/CLAUDE/AGENTS（e2e 铁律）。

**不做（留待 Sprint 16+）**
- 视觉回归 / 截图 diff（本 Sprint 只做功能 e2e）；可访问性审计；性能/负载测试。
- 跨浏览器矩阵（只 chromium；firefox/webkit later）；移动端/响应式 e2e。
- **浏览器扩展的完整 MV3 e2e**（side panel / service worker 自动化在离线下易脆）——本 Sprint 至多做「扩展构建产物可在 chromium 加载、不报错」的轻冒烟（可行则做，不可行则文档标注为已知缺口）；扩展完整 e2e 留作专项。
- 真实 provider 的 e2e（永远 stub，不连真 Google/Stripe/LLM/搜索）；PG-backed e2e（本 Sprint 用内存 BFF 求 hermetic；PG 集成已在单元层覆盖，PG e2e 留待 later）。

**全程铁律**（违反即返工，见 [AGENTS.md](../AGENTS.md)）：**e2e 必须 hermetic & 离线**——内存 BFF + 全 stub provider，**无真实网络/无外部凭证**，确定性可复跑；**e2e 跑真实整合栈**（构建后的前端 → 真实 BFF over HTTP/SSE），**不是 mock fetch**（这正是它区别于组件测试的价值）；**每次运行隔离**（全新内存 BFF + 临时端口，无共享全局状态），teardown 必关服务器/浏览器；**单源**托管（SPA 同源，cookie 自然生效），不为过 e2e 而削弱生产默认（prod-mode 配置只在测试内经 env 注入）；**保留既有测试层**（单元/契约/web 组件/eval 不动），e2e 是**附加**；CI 里 chromium 在 job 内安装、失败留 trace、超时有界、retry 只用于掩盖已知可接受抖动而非真实失败；改动集中在 `e2e/`、`apps/bff`(静态托管)、`.github/workflows`、docs；不偷工（被裁剪的覆盖面要在 PR/文档显式说明）。

---

## 里程碑 A — E2E 框架 + 鉴权旅程

### S15-T1 · Playwright 框架 + 内存 BFF fixture + BFF 单源托管 SPA
- **做**：新 `e2e/`（@apolla/e2e）：Playwright 配置（chromium、headless、trace on failure、有界超时）。fixture/global-setup：`buildHarness()`（**不设 `DATABASE_URL`** → 内存）+ stub provider 默认 → `createServer(handle)` 临时端口；BFF 加**静态 SPA 托管**（服务 `apps/web/dist` + 未命中 API 的 GET 回退 `index.html`），env 门控。Playwright 直连该单源。一个冒烟用例（加载 → 见登录页）。
- **DoD**：`pnpm e2e` 本地：build web → 起内存 BFF（托管 dist）→ chromium 打开 → 登录页可见；teardown 干净（无悬挂端口/进程）；离线（无网络）。
- **改动**：`e2e/*`（playwright.config、fixtures、smoke.spec）、`apps/bff/src/server.ts`（静态托管 + SPA fallback）、根 `package.json`（`e2e` 脚本）。
- **依赖**：S09 前端、S10 `{handle,setHarness}`。

### S15-T2 · 鉴权旅程 e2e
- **做**：注册（邮箱+密码）→ 进工作台；登出 → 登录；**Stub SSO**（点「Continue with Demo SSO」→ 经 `/start`→`/callback` → 已登录、设置页「已连账号」含 stub）；鉴权门（未登录访问受保护路由 → 登录页）。
- **DoD**：上述四条在真实浏览器通过；会话 cookie 跨页面保持（单源）；SSO 回跳落在工作台。
- **依赖**：S15-T1、S10 鉴权、S14 OAuth（Stub provider）。

---

## 里程碑 B — 核心产品旅程 e2e

### S15-T3 · 研究旅程 e2e（真实 SSE）
- **做**：登录 → 提一个研究问题 → **真实 SSE** 流式 token 渲染 → 最终答案 + 引用出现 → 导出链接（md/html）可点/可下载。用确定性 Mock/Demo adapter，断言稳定文本。
- **DoD**：浏览器里看到流式增量 + 终态答案 + 引用；导出 URL 200。无 mock fetch（真 SSE）。
- **依赖**：S15-T1/T2、S01/S09 研究链路。

### S15-T4 · 计费 + 套餐门禁旅程 e2e
- **做**：登录 → Billing 页看 free + 用量 → 升级 Pro（**stub Checkout 立即激活**）→ 显示 Pro + 用量 → 取消 → 回 free；可加：free 用户触发 pro 功能（cowork/media）→ 见升级提示/402 处理。
- **DoD**：升级/取消在浏览器走通且 UI 反映；门禁提示正确。
- **依赖**：S15-T1/T2、S13 计费。

---

## 里程碑 C — 覆盖广度 + 发布就绪

### S15-T5 · 工作区/Surfaces 旅程 e2e（+ 扩展轻冒烟）
- **做**：登录 → 跑一个 Surface（如翻译）或存一个产物 → 工作区列表出现 → 查看版本/历史。**扩展轻冒烟**（可行则做）：构建 `apps/extension` → Playwright `launchPersistentContext` 加载 MV3 → 扩展无加载错误 / 背景 service worker 起来；若离线下 side panel/SW 自动化过脆 → 退化为「构建产物存在且 manifest 合法」断言并文档标注。
- **DoD**：工作区旅程通过；扩展冒烟（达成的那层）通过或显式记为已知缺口。
- **依赖**：S15-T1、S07 工作区/S08 Surfaces、S12 扩展。

### S15-T6 · 生产构建模式 e2e + 发布 runbook
- **做**：一条 e2e 在**生产化配置**下跑（构建产物 + 如 `AUTH_MODE=password`、单源、关 demo 宽松项；Secure cookie 在 http 测试环境的取舍要处理），验证核心旅程在 prod 配置下通。`docs/DEPLOY.md`：单源部署步骤、env 清单（含 S10–S14 的 `SESSION_SECRET`/`SECRETS_KEY`/`STRIPE_*`/`GOOGLE_*`/`GITHUB_*`/`DATABASE_URL`）、健康检查（`/api/health`、`/metrics`）。确认 `pnpm build` 产出可部署且 BFF 能托管它。
- **DoD**：prod-mode e2e 绿；DEPLOY.md 可照做；不削弱生产默认（测试内经 env 注入）。
- **依赖**：S15-T1、S10 安全。

---

## 里程碑 D — CI 接入 + 文档

### S15-T7 · CI e2e job + 稳定性
- **做**：`.github/workflows/ci.yml` 加 `e2e` job：装 pnpm/Node → `pnpm install` → `pnpm --filter @apolla/web build` → `npx playwright install --with-deps chromium` → `pnpm e2e`（headless）。失败上传 trace/截图工件；超时有界；确定性 stub、无网络；作为必过门禁。控制时长（必要时按旅程分片/并行）。
- **DoD**：CI 上 e2e 稳定通过（多次复跑无抖动）；失败有可下载诊断；总时长可接受。
- **依赖**：S15-T1…T6。

### S15-T8 · 文档回写
- **做**：README（`pnpm e2e` 怎么跑、覆盖哪些旅程、离线确定性、需要 chromium）；ARCHITECTURE（测试金字塔：单元/契约 → web 组件 → **e2e 整合网**；与 evals 的分工）；CLAUDE/AGENTS（e2e 铁律：hermetic/离线/全 stub/真实栈/单源）；Sprint 15 DoD 勾选。
- **DoD**：新人照 README 本地跑通 e2e；文档准确。
- **依赖**：S15-T1…T7。

---

## 执行顺序与并行建议

```
S15-T1(框架+内存BFF+单源托管) ─ S15-T2(鉴权旅程) ─┬─ S15-T3(研究/SSE)
                                                   ├─ S15-T4(计费门禁)
                                                   ├─ S15-T5(工作区+扩展冒烟)
                                                   └─ S15-T6(prod-mode+runbook)
                                       全部收口 → S15-T7(CI) → S15-T8(Docs)
```
- **关键路径**：S15-T1（框架 + 内存 BFF + 单源托管 SPA）是地基；之上的旅程互相独立，可并行写。
- **每完成一个任务**：本地 `pnpm e2e` 该 spec 绿 + 不破坏既有门禁；一任务一 PR，CI 绿即合。
- **建议 PR 分组**：A(T1+T2) · B(T3+T4) · C(T5+T6) · D(T7+T8)。

## Sprint 15 Definition of Done（整体验收）
- [x] E2E 框架：`e2e/` + Playwright（chromium）+ 内存 BFF fixture + 全 stub；`pnpm e2e` 本地绿、离线、teardown 干净。
- [x] BFF 单源托管 SPA（服务 `apps/web/dist` + SPA fallback），cookie 同源生效。
- [x] 鉴权旅程：注册/登录/登出/Stub SSO/鉴权门 e2e 通过。
- [x] 研究旅程：真实 SSE 流式 + 报告内容 + 导出 e2e 通过。
- [x] 计费旅程：升级→Pro→取消→free e2e 通过。
- [x] 工作区/Surfaces 旅程 e2e 通过；扩展冒烟（MV3 manifest 构建 + 最小权限校验）通过，完整浏览器 MV3 e2e 记为已知缺口。
- [x] 生产构建模式 e2e 绿（password 模式 + 单源托管）+ `docs/DEPLOY.md` runbook。
- [x] CI `e2e` job（chromium 安装、失败留 trace/截图）；既有门禁不退化。
- [x] README/架构文档更新。

> **Sprint 15 完成**（PR [#86](https://github.com/Timsunzhuping/ApollaAIStudio/pull/86) A · [#87](https://github.com/Timsunzhuping/ApollaAIStudio/pull/87) B · [#88](https://github.com/Timsunzhuping/ApollaAIStudio/pull/88) C · D 本次）。新 `e2e/`（@apolla/e2e）**Playwright（chromium）** 真实浏览器 e2e：打**真实整合栈**（构建后 web SPA → 真实 BFF over HTTP/真实 SSE/真实会话 cookie），**hermetic & 离线**（内存 BFF 不设 `DATABASE_URL` + 全 stub provider）。BFF 新增**单源托管 SPA**（`WEB_DIST` → `apps/web/dist`，静态资源 + SPA fallback；env 门控、未设维持内联 UI）——cookie/SSE 天然生效且单源可部署。**9 个 spec**：smoke、鉴权（注册/登出/登录 + Stub SSO + 鉴权门）、研究（真实 SSE + 导出）、计费（升级/取消）、工作区（Surface→工作区）、扩展 manifest 冒烟、发布（单源 + password 模式 + health/metrics）。e2e 全程 password 鉴权模式（prod-like）。`docs/DEPLOY.md` 单源部署 runbook + 全 env 矩阵。CI 独立 `e2e` job（装 chromium、失败留 trace）。9/9 本地绿；既有门禁（268 root + 21 web + eval 37）不退化。完整 MV3 浏览器 e2e（side panel/SW）列为已知缺口。

## 风险与提示（给代理）
- **hermetic 优先**：e2e 用**内存 BFF**（不设 `DATABASE_URL`）+ 全 stub provider；绝不连真实网络/凭证；同一旅程可复跑不抖。
- **真实栈才有价值**：e2e 必须打真实 BFF（HTTP + **真实 SSE** + 真实会话 cookie），不许 mock fetch——否则退化成组件测试。
- **单源消解 cookie 噩梦**：让 BFF 托管 web dist（SPA fallback），Playwright 只访问这一个源；避免跨源 cookie 的 SameSite/Secure 泥潭。这同时是真实的发布就绪改进。
- **确定性断言**：用 Mock/Demo adapter 的稳定输出做断言；SSE 用 Playwright 的 `expect(...).toContainText` 轮询等待，别 sleep 固定毫秒。
- **隔离与清理**：每次 run 全新内存 BFF + 临时端口；teardown 关 server + 浏览器；无端口/进程泄漏（CI 会因悬挂卡住）。
- **CI 时长**：chromium 安装 + 构建会加时；必要时旅程分片/并行 worker；失败务必留 trace/截图，否则 e2e 难调。
- **扩展 e2e 诚实**：MV3 side panel/SW 离线自动化易脆——达成可行的那层（加载无错/manifest 合法），其余文档标注为已知缺口，别硬撑出脆测试。
- **prod-mode 不破生产**：prod 配置只在测试内经 env 注入（如 http 下 Secure cookie 的取舍）；绝不改弱生产默认值。
- **不确定/不可逆**（e2e 目录布局、单源托管的 env 开关、Secure-cookie 在测试环境的处理、扩展冒烟深度）→ 选保守默认并在 PR 标注。
