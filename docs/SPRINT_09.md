# Sprint 09 执行单 — Production Web Frontend（apps/web：Vite + React + TS SPA）

> 读者：**Codex / Claude Code**。逐任务从上往下执行；每个任务自带验收（DoD）、依赖、改动位置。
> 前置必读：[ARCHITECTURE.md](./ARCHITECTURE.md) §2/§7 · [AGENTS.md](../AGENTS.md) · `apps/bff/src/server.ts`（现有 HTTP/SSE API 全集）· Sprint 01–08（已完成）。
> 目标产物（Sprint Demo）：**一个真正能上线给 C 端用户的 Web 应用 `apps/web`** —— 登录 → 研究（流式报告/来源/成本/导出）→ 工作区（文件树/版本/Writer）→ Surfaces（翻译/表格/纪要）→ Agent/Cowork/Plugins → 自动化（定时/Job/通知）→ 连接器/设置。消费**现有 BFF API**（不改后端职责），组件化架构 + 设计系统 + 流式（SSE）。全程 typecheck/lint/build/组件测试在 CI 绿。

## 0. Sprint 范围与非目标

**主题**：八个 Sprint 建好了能力，但用户能看到的只有 `apps/bff` 里一页内联 HTML demo。本 Sprint 把它升级为**生产级前端**：一个独立的 **Vite + React + TypeScript 单页应用** `apps/web`，通过**类型化 API 客户端 + SSE hooks** 消费 BFF 现有的 HTTP/SSE 接口，覆盖全部产品面，带真实的组件架构、设计系统、路由、鉴权、流式、空/错/载状态。

**为什么是 SPA（Vite+React）而不是 Next.js**：BFF 是**刻意独立**的 Node 后端（运行时读 `config/*` 文件，避开 bundler-vs-fs 问题，见 [ARCHITECTURE §7]）。前端是纯 API 客户端——已鉴权、强交互、全程流式，**SEO 无意义**，SSR 只会与独立 BFF 产生摩擦。SPA 最干净：BFF 仍是唯一后端，前端 build 成静态资源由任意静态服务/BFF 托管。营销/SSR 落地页可作为后续独立 Next 层（非本 Sprint）。

**做（本 Sprint 的闭环）**
- `apps/web` 脚手架：Vite + React + TS（strict）、设计 tokens + 应用外壳（侧栏导航 + 顶栏）、客户端路由、鉴权上下文（login/me/logout + 受保护路由）。
- 类型化 API 客户端（`lib/api.ts`，尽量复用 `@apolla/contracts` 类型）+ SSE hook（`lib/sse.ts`，统一解析事件流、重连、清理）。
- 产品页（消费现有 BFF 接口，不新增后端职责）：**研究**（流式报告/计划/来源/成本/导出 + 项目/技能选择 + 一键封面/视频）、**工作区**（文件树/查看/版本/回滚/下载 + Writer）、**Surfaces**（翻译/表格/会议纪要 → 产物落工作区）、**Agent/Cowork/Plugins**（连接器管理 + Agent 运行含确认 + Plugin 市场 + Cowork fan-out 轨迹）、**自动化**（定时任务 + Job 历史含 SSE 重放 + 通知收件箱）、**设置**（记忆/偏好）。
- 质量与交付：API 客户端 + SSE hook 单测、关键页面组件测试（vitest + @testing-library/react + jsdom，mock fetch/EventSource）；响应式 + 空/错/载/a11y 基础；dev 脚本（Vite dev + 代理 `/api`·`/media` → BFF）；build 产物。
- CI 集成：`apps/web` 接入 typecheck/lint/test/build 全门禁；文档回写。

**不做（留待 Sprint 10+）**
- SSR/SEO 营销站、移动原生 App、PWA/离线、完整 i18n、设计系统独立发包。
- 端到端浏览器测试（Playwright/Cypress）——本 Sprint 用组件/单元测试；e2e 留待后续。
- 改动 BFF 后端职责 / 新增大型后端能力（仅在确有缺口时补**最小**端点）。
- 实时协同（CRDT）、表格公式引擎、ASR 语音（与前端无关，属各自专题 Sprint）。

**全程铁律**（违反即返工，见 [AGENTS.md](../AGENTS.md)）：前端是**纯 API 客户端**，不旁路 BFF、不直连模型/数据库；**类型化**（TS strict，API 类型尽量源自 `@apolla/contracts`，不 `any` 滥用）；**安全**：渲染服务端/工具/文档内容时不 `dangerouslySetInnerHTML` 未净化内容（Markdown 经安全渲染），不在前端持有密钥（鉴权走 BFF 的会话 cookie）；SSE 连接必在卸载时清理（防泄漏）；保留 `apps/bff` 内联 demo 不破坏（`apps/web` 为新增）；每个产品页有组件/客户端测试；改动集中在新增 `apps/web` + 必要时 `apps/bff`（最小端点）+ CI。

---

## 里程碑 A — 基座 + 研究页

### S9-T1 · apps/web 脚手架 + 设计系统 + API 客户端 + 鉴权
- **做**：`apps/web`（Vite + React + TS strict，加入 pnpm workspace）。设计 tokens（颜色/间距/字体，CSS 变量）+ 应用外壳（侧栏导航 + 顶栏 + 内容区）。客户端路由（react-router 或等价）。鉴权上下文：`/api/auth/login|me|logout`，未登录 → 登录页，已登录 → 受保护壳。类型化 API 客户端 `lib/api.ts`（fetch 包装：JSON + 错误处理 + 同源/可配 base）+ SSE hook `lib/sse.ts`（EventSource 包装：onEvent、错误、卸载清理）。`pnpm --filter @apolla/web dev/build/test/lint/typecheck` 脚本就绪。
- **DoD**：`pnpm --filter @apolla/web build` 通过；登录流程走通（mock fetch 测试）；外壳渲染导航；API 客户端 + SSE hook 有单测；typecheck/lint 绿。
- **改动**：`apps/web/*`（新增）、根 `pnpm-workspace`/CI。
- **依赖**：BFF 现有 auth 接口。

### S9-T2 · 研究页（旗舰流式闭环）
- **做**：研究页：输入问题 → `POST /api/tasks` → `GET /api/tasks/:id/events`（SSE）渲染 计划/阶段进度/逐字报告/来源/实时成本 → 完成后导出 `.md`/`.html` + 一键封面/讲解视频（`/api/tasks/:id/media`）；项目选择（`/api/projects`）、技能复跑（`/api/skills` + `/api/skills/run`）、存为技能。Markdown 安全渲染。
- **DoD**：浏览器（dev 代理到 BFF）里问一个问题 → 看到流式报告 + 来源 + 成本 → 导出；组件测试用 mock SSE 验证事件→UI 映射（plan/delta/sources/cost/done）。
- **依赖**：S9-T1。

---

## 里程碑 B — 工作区/Surfaces + Agent/Cowork/Plugins

### S9-T3 · 工作区页 + Surfaces 页
- **做**：**工作区**：文件树（`/api/workspace`）+ 查看（`/api/workspace/file`）+ 版本历史/回滚（`/history`、`/rollback`）+ 下载（`?download=1`）+ Writer（`/api/writer`）+ 存成品。**Surfaces**：选面（`/api/surfaces`）→ 文本/选文件输入 + 参数 → `POST /api/surface` → 产物入文件树；翻译/表格（含加列）/会议纪要。
- **DoD**：研究产物存工作区 → Writer 改 → 版本/回滚/下载；跑翻译/表格/纪要 → 产物即时出现在文件树；组件测试覆盖文件树渲染 + surface 运行（mock fetch）。
- **依赖**：S9-T1。

### S9-T4 · Agent / Cowork / Plugins 页
- **做**：**连接器**管理（`/api/connectors` 增删/开关）。**Agent**：目标 → `/api/agent` + `/:id/events`（SSE）轨迹 + **确认弹窗**（`/:id/confirm`）+ 审计（`/api/audit`）。**Plugins**：市场（`/api/plugins/official`）安装/卸载（`/api/plugins(/install)`）+ 缺连接器提示。**Cowork**：目标 → `/api/cowork` → Job SSE 渲染子代理 fan-out 轨迹 + file-written + 汇总。
- **DoD**：连接 MCP → 跑 Agent → 低风险写入弹确认 → 审计；装 Plugin → 跑 Cowork → 看子代理轨迹 + 产物；组件测试覆盖确认流 + fan-out 轨迹（mock SSE）。
- **依赖**：S9-T1。

---

## 里程碑 C — 自动化 + 测试

### S9-T5 · 自动化页（定时/Job/通知）+ 设置
- **做**：**定时任务**（`/api/schedules` 建/启停/run-now/删）。**Job 历史**（`/api/jobs` + `/:id/events` SSE 重放）。**通知收件箱**（`/api/notifications` + 已读）。**设置**：记忆偏好（`/api/memory/model`）、清记忆。
- **DoD**：建一个每日研究定时 → run-now → Job 历史出现 → 完成通知；断连重连 Job 事件仍完整；组件测试覆盖定时 CRUD + 通知已读（mock fetch）。
- **依赖**：S9-T1。

### S9-T6 · 测试加固（客户端 + 组件）
- **做**：补齐 `lib/api.ts` 单测（各端点 URL/方法/错误处理）、`lib/sse.ts` 单测（事件解析 + 清理）、每个产品页 1+ 冒烟渲染（mock fetch/EventSource，断言空/载/错/数据态）。引入 jsdom + RTL 环境。
- **DoD**：`pnpm --filter @apolla/web test` 覆盖客户端 + 五个页面关键路径；CI 必过；故意改坏端点/事件映射任一即变红。
- **依赖**：S9-T2…T5。

---

## 里程碑 D — 交付与门禁

### S9-T7 · 设计打磨 + 交付体验
- **做**：响应式（窄屏可用）、空/错/载/骨架态、a11y 基础（语义标签、焦点、键盘）、统一组件（按钮/输入/卡片/对话框/吐司）。dev 体验：Vite dev 代理 `/api`·`/media` → BFF（`localhost:3000`），一条命令起前后端。
- **DoD**：窄屏与宽屏均可用；主要交互有载/错/空态；`pnpm --filter @apolla/web dev` + BFF 可本地联调；无控制台报错。
- **依赖**：S9-T2…T5。

### S9-T8 · CI 集成 + 文档回写
- **做**：`apps/web` 接入 CI（typecheck · lint · test · build 全门禁，与现有并行）。更新 README（新增"生产前端"段 + 本地起法）/ARCHITECTURE（§2 四层补"Web 前端层"、§7 布局加 `apps/web`）/CLAUDE/AGENTS。`apps/bff` 内联 demo 保留为零配置兜底。
- **DoD**：CI 对每个 PR 跑 web 的 4 道门；README 起法准确（前后端联调）；架构文档含前端层；Sprint 09 DoD 勾选。
- **依赖**：S9-T1…T7。

---

## 执行顺序与并行建议

```
S9-T1(脚手架+API客户端+鉴权) ─ S9-T2(研究页) ─┬─ S9-T3(工作区/Surfaces)
                                              ├─ S9-T4(Agent/Cowork/Plugins)
                                              └─ S9-T5(自动化/设置)
                              全部页就绪 → S9-T6(测试加固) → S9-T7(打磨) → S9-T8(CI/Docs)
```
- **关键路径**：S9-T1（脚手架 + API 客户端 + SSE hook + 鉴权外壳）是地基；四个产品页（T2-T5）在其上并行。
- **每完成一个任务**：跑 web typecheck/lint/test/build；一任务一 PR，CI 绿即合；提交说明写清「新增哪个页 + 消费哪些 BFF 端点 + 加了哪些测试」。
- **建议 PR 分组**：A(T1+T2) · B(T3+T4) · C(T5+T6) · D(T7+T8)。

## Sprint 09 Definition of Done（整体验收）
- [ ] `apps/web`（Vite+React+TS strict）：设计系统 + 外壳 + 路由 + 鉴权（受保护路由）；纯 API 客户端，不旁路 BFF。
- [ ] 类型化 API 客户端 + SSE hook（卸载清理）；类型尽量源自 `@apolla/contracts`。
- [ ] 五大产品面页可用：研究（流式）/工作区+Writer/Surfaces/Agent+Cowork+Plugins/自动化+设置——均消费现有 BFF 接口。
- [ ] 流式：研究/Agent/Cowork/Job 走 SSE，事件→UI 正确，断连重连不丢（Job 重放）。
- [ ] 安全：Markdown 安全渲染、不持密钥、SSE 清理；`apps/bff` 内联 demo 不破坏。
- [ ] 测试：API 客户端 + SSE hook 单测 + 五页冒烟（mock fetch/EventSource）；CI 全门禁绿。
- [ ] CI 含 web typecheck/lint/test/build；README/架构文档更新；本地前后端联调可走通。

## 风险与提示（给代理）
- **纯客户端，别旁路 BFF**：所有数据/流式经 BFF HTTP/SSE；前端不直连模型/库、不持密钥；鉴权走会话 cookie。
- **类型源自 contracts**：尽量 import `@apolla/contracts` 类型描述响应，减少手写漂移；确无对应时本地最小声明。
- **SSE 必清理**：每个 EventSource 在组件卸载/重跑时 close；统一进 `useSSE` hook，避免连接泄漏与重复渲染。
- **Markdown 安全渲染**：报告/产物是不可信内容——用安全渲染（白名单），绝不裸 `dangerouslySetInnerHTML`。
- **测试可确定性**：mock `fetch` 与 `EventSource`（注入假事件序列），断言事件→UI 映射与空/错/载态；不依赖真实 BFF/网络（CI 离线）。
- **不改后端职责**：BFF 接口已齐全；确有缺口只补**最小**端点并在 PR 标注，不借机重写后端。
- **保留 demo**：`apps/bff` 内联 UI 是零配置兜底，别删；`apps/web` 是面向用户的生产前端。
- **不确定/不可逆**（路由方案、状态管理选型、组件库 vs 自研）→ 选**轻**默认（react-router + 自研轻组件 + 局部状态/Context，避免重型依赖）并在 PR 标注。
