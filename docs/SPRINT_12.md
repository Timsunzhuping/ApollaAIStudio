# Sprint 12 执行单 — Browser Extension（MV3）：在任意网页上用 Apolla

> 读者：**Codex / Claude Code**。逐任务从上往下执行；每个任务自带验收（DoD）、依赖、改动位置。
> 前置必读：[ARCHITECTURE.md](./ARCHITECTURE.md) §2 · [AGENTS.md](../AGENTS.md) · `apps/web/src/lib`（API 客户端/SSE 范式）· `apps/bff/src/server.ts`（鉴权/CORS/会话/Surface/研究 API）· Sprint 01–11（已完成）。
> 目标产物（Sprint Demo）：**装上扩展 → 在任意网页划词 → 右键/侧边栏「用 Apolla 研究/翻译/总结」→ 侧边栏流式出结果 → 一键存入工作区。** 扩展是纯 BFF 客户端（用 **API token** 跨源鉴权），全程离线可测（mock fetch + facade 化 chrome API），不旁路后端。

## 0. Sprint 范围与非目标

**主题**：十一个 Sprint 把后端能力、安全、前端、工具生态全建好了，但产品只能在自家页面用。最大的 To-C 增长杠杆是**分发**——把 Apolla 带到用户工作的任意网页（Monica 式侧边栏 wedge）。本 Sprint 落地 **MV3 浏览器扩展** `apps/extension`：复用既有安全 BFF API（研究/Surface/工作区），新增一条**跨源鉴权通道（API token）**+ 一条**SSE-over-fetch**（EventSource 不能带 Bearer 头）。扩展是又一个薄客户端，不引入新执行通道。

**做（本 Sprint 的闭环）**
- API token（BFF）：在设置里生成/列出/吊销 **API token**（`apolla_<random>`，**哈希存储、仅展示一次**）；带 `Authorization: Bearer apolla_<token>` 的请求按 owner 鉴权（与会话 cookie 并存）。这是扩展（及未来 CLI）跨源鉴权的干净通道，绕开扩展跨源 cookie 的坑。
- 扩展脚手架：`apps/extension`（Vite + MV3 + React）—— manifest v3（background service worker + content script + 侧边栏 side panel），多入口构建；共享 API 客户端（Bearer token、可配 base）；侧边栏壳 + token 设置页。
- 划词与动作：content script 抓取选区 + 页面标题/URL（作为 untrusted 数据）；background 注册右键菜单/侧边栏动作（研究 / 总结 / 翻译 选区或整页）→ 路由到 BFF → 打开侧边栏渲染。
- 侧边栏产品面：研究（**SSE-over-fetch** 流式）+ 翻译/总结当前页（Surface API）+ **一键存入工作区**；近期结果列表。
- 安全与交付：token 存 `chrome.storage`（不进 content script）；选区/页面内容是 untrusted（安全 Markdown 渲染）；**最小权限**（activeTab + 配置的 BFF host）；测试（token/客户端/消息路由/面板/SSE 解析）+ MV3 构建 + 文档。

**不做（留待 Sprint 13+）**
- Chrome Web Store 发布流程；真实浏览器 e2e（Playwright，单独 Sprint）；Firefox/Safari 移植。
- 整页正文抽取/阅读模式（本 Sprint 只取**选区 + 基础页面文本/标题/URL**）；页面 DOM 操作/自动化（computer-use 类）。
- OAuth/SSO 登录（扩展用 API token + 既有密码/demo 登录）；离线/PWA。

**全程铁律**（违反即返工，见 [AGENTS.md](../AGENTS.md)）：扩展是**纯 BFF 客户端**——不直连模型/库、不持模型密钥；**API token 哈希存储**（scrypt，绝不明文/入日志）、token 仅存 `chrome.storage`、绝不注入 content script、绝不进页面 DOM；**页面选区/内容是 untrusted 数据**（经数据通道 / 安全 Markdown 渲染，不当指令、不裸 `innerHTML`）；最小权限 manifest；SSE-over-fetch 必有超时 + 卸载清理；不改 BFF 既有安全（token 走与会话同一鉴权门、计入限流/owner 隔离）；chrome.* 经 facade 注入以便离线测试；保留 `apps/bff`/`apps/web` 不破坏；改动集中在新增 `apps/extension` + `apps/bff`(token)/`harness-core`(token 存储) + `apps/web`(设置页 token UI) + CI。

---

## 里程碑 A — API token + 扩展脚手架

### S12-T1 · API token（BFF 跨源鉴权）
- **做**：`contracts` 加 `ApiToken`（id/ownerId/name/hashedToken/createdAt/lastUsedAt?）。`harness-core` 加 token 哈希（复用 scrypt）+ `ApiTokenRepository`（内存 + Postgres）。BFF：`POST /api/tokens {name}` → 生成 `apolla_<random>`、哈希存储、**明文仅此一次返回**；`GET /api/tokens`（列出，不含明文）；`DELETE /api/tokens/:id`。鉴权门扩展：若有 `Authorization: Bearer apolla_…` → 查 token → 设 ownerId（与 cookie 并存）；token 鉴权同样受限流 + owner 隔离。
- **DoD**：建 token → 用 Bearer 调 `/api/auth/me`/受保护端点成功；吊销后 401；token 明文不二次返回、DB 无明文；单测覆盖 token 哈希/校验 + 鉴权门。
- **改动**：`contracts/src/api-token.ts`、`harness-core/src/auth/*`、`db-postgres`、`apps/bff`（鉴权门 + 端点）、`apps/web`（设置页生成/吊销 token）。
- **依赖**：Sprint 10 鉴权/会话/限流。

### S12-T2 · apps/extension 脚手架（Vite + MV3 + React）
- **做**：`apps/extension`（加入 workspace）。manifest v3（`background.service_worker`、`content_scripts`、`side_panel`/`action`，`permissions: [activeTab, storage, contextMenus]`、`host_permissions` 指向 BFF）。Vite 多入口构建（background/content/panel）。共享 API 客户端（Bearer token，base 从 `chrome.storage` 读，**chrome facade 注入**）。侧边栏壳 + 设置页（填 BFF base + 粘 API token + 校验）。
- **DoD**：`pnpm --filter @apolla/extension build` 产出 MV3 包（manifest + 三入口）；侧边栏渲染；设置页存/读 token（mock chrome storage）；API 客户端单测；typecheck/lint 绿。
- **依赖**：S12-T1、Sprint 09 前端范式。

---

## 里程碑 B — 划词与动作 + 流式

### S12-T3 · content script + background 动作
- **做**：content script 抓取选区文本 + `document.title`/`location.href`（**untrusted**），发消息给 background。background：右键菜单 + 侧边栏动作（研究选区 / 总结页面 / 翻译选区），把请求路由到 BFF，打开侧边栏并传上下文。chrome.* 经 facade，消息处理器写成可单测的纯函数。
- **DoD**：单测：选区消息 → 正确的 BFF 调用意图（研究/surface + 参数）；facade mock 下右键动作触发面板打开 + 携带选区；content script 不接触 token。
- **依赖**：S12-T2。

### S12-T4 · 侧边栏流式结果（SSE-over-fetch）
- **做**：因 EventSource 不能带 `Authorization` 头，实现 **SSE-over-fetch**（fetch + `ReadableStream` 读 `text/event-stream`，解析 `data:` 帧，带超时 + abort）。侧边栏：发起研究 → 流式渲染报告/来源/成本（安全 Markdown）→ 完成。错误/空/载态。
- **DoD**：单测：SSE-over-fetch 解析多帧 + 终止 + 超时；面板组件在 mock 流下渲染报告/来源（mock fetch stream）。浏览器手测：划词研究 → 侧边栏流式出结果。
- **依赖**：S12-T2。

---

## 里程碑 C — 页面 Surface + 安全/交付

### S12-T5 · 页面翻译/总结 + 存入工作区
- **做**：侧边栏「翻译当前页 / 总结当前页 / 总结选区」→ 调 Surface API（translate/notes/sheet 复用）→ 渲染 → **一键存入工作区**（`save-artifact`）。近期结果列表（chrome.storage）。
- **DoD**：浏览器：选区/页面 → 翻译/总结 → 结果 → 存工作区（在 web 端工作区可见）；组件测试覆盖 surface 调用 + 保存（mock fetch）。
- **依赖**：S12-T4、Sprint 08 Surface、Sprint 07 工作区。

### S12-T6 · 扩展安全 + 最小权限 + UX
- **做**：token 仅存 `chrome.storage.local`、永不进 content script / 页面 DOM；页面内容 untrusted（安全渲染，不裸 HTML）；manifest 最小权限（activeTab + 配置 host，不要 `<all_urls>` 宽授权）；请求超时；登出/清 token；错误/空/载/重连态。
- **DoD**：审查 + 测试：token 不出现在 content script 包/页面；surface/研究渲染不执行页面注入的脚本/指令；权限清单最小；清 token 后调用 401 提示重设。
- **依赖**：S12-T2…T5。

---

## 里程碑 D — 质量闸门

### S12-T7 · 测试加固
- **做**：BFF API token（建/用/吊销/鉴权门）；扩展 API 客户端（Bearer/base/错误）；background 消息路由（纯函数 + facade mock）；侧边栏面板组件（jsdom + RTL，mock fetch/stream）；SSE-over-fetch 解析器。CI 离线确定性。
- **DoD**：`pnpm test`（BFF token）+ `pnpm --filter @apolla/extension test`（客户端/路由/面板/SSE）覆盖以上；CI 全门禁绿；故意破坏（token 不鉴权 / token 入日志 / 页面注入升级 / SSE 不解析）任一即变红。
- **依赖**：S12-T1…T6。

### S12-T8 · 构建 + 文档
- **做**：`apps/extension` 接入 CI（typecheck/lint/test/build）。README/ARCHITECTURE（触点层 + 扩展架构 + API token）/CLAUDE/AGENTS。本地装载说明（`build` → Chrome 加载已解压扩展 → 设置 BFF base + token）。
- **DoD**：CI 跑扩展 4 道门；README 装载步骤准确；架构含扩展层 + token；Sprint 12 DoD 勾选。
- **依赖**：S12-T1…T7。

---

## 执行顺序与并行建议

```
S12-T1(API token) ─ S12-T2(扩展脚手架) ─┬─ S12-T3(content/background)
                                         ├─ S12-T4(SSE-over-fetch 面板)
                                         ├─ S12-T5(页面 Surface + 存工作区)
                                         └─ S12-T6(安全/权限/UX)
                              全部收口 → S12-T7(测试) → S12-T8(构建/Docs)
```
- **关键路径**：S12-T1（token）→ S12-T2（脚手架 + 客户端 + SSE-over-fetch 基础）是地基；划词/流式/Surface/安全在其上并行。
- **每完成一个任务**：跑扩展 typecheck/test/build + 相关回归；一任务一 PR，CI 绿即合；提交说明写清「新增哪个入口/动作 + 消费哪些 BFF 端点 + 加了哪些测试」。
- **建议 PR 分组**：A(T1+T2) · B(T3+T4) · C(T5+T6) · D(T7+T8)。

## Sprint 12 Definition of Done（整体验收）
- [ ] API token：生成（明文仅一次）/列出/吊销，哈希存储；Bearer 鉴权与会话并存、受限流 + owner 隔离；web 设置页可管理。
- [ ] 扩展脚手架：MV3（background/content/side panel）多入口构建；Bearer API 客户端；设置页存/校验 token；chrome.* facade 化。
- [ ] 划词与动作：content script 抓选区/页面（untrusted）；background 右键/侧边栏动作路由到 BFF。
- [ ] 流式：SSE-over-fetch（带 Bearer，超时/清理）；侧边栏流式渲染研究（安全 Markdown）。
- [ ] 页面 Surface：翻译/总结页面或选区 → 一键存入工作区。
- [ ] 安全：token 仅 chrome.storage、不进页面；页面内容 untrusted 不升级；最小权限 manifest。
- [ ] `pnpm test` + 扩展测试覆盖 token/客户端/路由/面板/SSE；CI 全门禁绿（含扩展 build）。
- [ ] README/架构文档更新（装载 + token）；离线可测，浏览器可手测。

## 风险与提示（给代理）
- **token 是跨源鉴权的关键**：EventSource 不能带头 → 用 API token + SSE-over-fetch；token 哈希存储、仅 chrome.storage、绝不进 content script/页面 DOM/日志。
- **页面内容永远 untrusted**：选区/标题/页面文本是数据通道证据，安全 Markdown 渲染，绝不当指令、绝不裸 `innerHTML`/执行。
- **chrome.* facade 化**：把 `chrome.runtime/contextMenus/sidePanel/storage` 包一层接口，逻辑写纯函数 + 注入 facade，CI 用 mock 跑（jsdom 无 chrome）。
- **最小权限**：manifest 用 `activeTab` + 明确 `host_permissions`（BFF host），不用 `<all_urls>`；少要权限更易过审、更安全。
- **复用一切**：研究/Surface/工作区/鉴权全走既有 BFF；扩展只做"采集页面上下文 + 薄 UI + 跨源鉴权"，不重写能力。
- **测试边界要诚实**：本 Sprint 测逻辑（客户端/路由/面板/SSE）+ 构建；真实浏览器集成（Playwright e2e）留待后续 Sprint，PR 里写明。
- **不确定/不可逆**（token 前缀/长度、manifest 权限集、SSE 超时默认、侧边栏 vs 弹窗）→ 选保守安全默认并在 PR 标注。
