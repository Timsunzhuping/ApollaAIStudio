# Sprint 18 执行单 — Open Capability Provider：Apolla 作为 MCP Server

> 读者：**Codex / Claude Code**。逐任务从上往下执行；每个任务自带验收（DoD）、依赖、改动位置。
> 前置必读：[ARCHITECTURE.md](./ARCHITECTURE.md)（公理①开放工具生态 / 适配器矩阵）· [AGENTS.md](../AGENTS.md)（执行/安全铁律）· `packages/adapters/mcp/src/http.ts` + `http.test.ts`（S11 的 **`HttpMCPClient`** + `StubHttpMcpServer`：JSON-RPC 2.0 `initialize`/`tools/list`/`tools/call` over HTTP POST 的线格式，含 `Mcp-Session-Id`）· `apps/bff/src/auth.ts` 的 **`readBearer`**（S12 API token → ownerId）· `packages/harness-core`（研究编排、`SurfaceRuntime`+translate/notes executors、`SkillRuntime`、workspace repo）· Sprint 11（MCP **客户端** + 连接器市场）· Sprint 12（API token）· Sprint 16/17（队列/追踪）。
> 目标产物（Sprint Demo）：**把 Apolla 的能力（研究/翻译/总结/技能/工作区读）以 **MCP 工具**对外暴露——任意 MCP 客户端（Claude Desktop / Cursor / IDE，乃至 **Apolla 自己的 `HttpMCPClient`**）用一个 **API token** 连上 `POST /api/mcp`，`tools/list` 看到 `apolla.research`/`apolla.translate`/… ，`tools/call` 即owner-scoped 执行并拿到结果；全程过配额/安全/审计/追踪；只暴露只读/低风险能力。**

## 0. Sprint 范围与非目标

**主题**：S11 让 Apolla 成为 MCP **客户端**（消费外部工具）。本 Sprint 做它的**对偶**——让 Apolla 成为 MCP **服务端**（把自己的能力暴露给外部 agent）。这是开放工具生态公理的闭环：Apolla 既能用别人的工具，也能被别人用。它**复用一切现成件**：能力（研究/Surface/技能/工作区）、**API token 鉴权**（S12）、JSON-RPC 线格式（S11 客户端已实现、可直接对接）、owner 隔离/配额/安全/审计/追踪（S10/S16/S17）。产物把 Apolla 变成生态里的一个**可被调用的节点**（分发渠道：Claude Desktop / Cursor / 任意 MCP 宿主），且能用我们自己的 `HttpMCPClient` **自测对环**（dogfood）。

**做（本 Sprint 的闭环）**
- MCP Server 协议核心：`harness-core` 加 `McpServer`（传输无关的 JSON-RPC 处理器：`initialize`/`tools/list`/`tools/call`）+ `CapabilityTool` 注册表（name/description/inputSchema(zod→JSON Schema)/handler(ownerId, args)）。离线、纯函数式。
- 暴露 Apolla 能力为 MCP 工具：`apolla.research`、`apolla.translate`、`apolla.summarize`、`apolla.run_skill`、`apolla.list_skills`、`apolla.workspace_list`、`apolla.workspace_read`——背后接既有编排/Surface/技能/工作区；**owner-scoped**、结构化 I/O（zod 校验）。
- 传输 + 鉴权 + BFF 端点：`POST /api/mcp`（JSON-RPC，**与 S11 `HttpMCPClient` 互通的线格式**），用 **API token（S12 Bearer）**鉴权 → ownerId；`initialize`/`tools/list`/`tools/call`；错误走 JSON-RPC error。
- 服务端边界治理：owner 隔离（token→ownerId、每个工具 owner-scoped、跨租户 fail-closed）、配额（MCP 调用计入）、安全（**只暴露只读/低风险能力，high_write/破坏性永不经 MCP**）、限流、审计、追踪（每次 `tools/call` 一个 span）；untrusted 入参 zod 校验。
- 发现与连接体验：能力目录（`tools/list` + 一个描述端点）；Web 设置页面板展示 **MCP 端点 URL + token 用法**（"把 Apolla 接进 Claude Desktop / Cursor"），给出可粘贴的 MCP 客户端配置片段。
- 对环自测（dogfood）：用 Apolla 自己的 `HttpMCPClient`（S11）连 Apolla 自己的 MCP Server，证明协议互通（连接器市场可加一条指向本地 MCP server 的条目）。
- 质量闸门：`initialize`/`tools/list`/`tools/call`（in-process handler）；鉴权（无 token 拒、token→owner-scoped）；各能力工具happy path + owner 隔离；配额/安全（高风险不暴露）；client↔server 对环；文档。

**不做（留待 Sprint 19+）**
- MCP **resources / prompts / sampling** 原语（本 Sprint 只做 **tools**）；长任务的 streamable-HTTP/SSE（研究等同步跑到完成、返回最终结果，长延迟先接受并标注；流式留后续）。
- MCP 的 **OAuth** 授权（用既有 API token）；WebSocket 传输；发布到公共 MCP registry。
- **暴露写/高风险能力**（媒体生成扣费、连接器写、工作区写、cowork 自治）——本 Sprint 一律不经 MCP；只读/低风险。
- 新能力本身（不新增编排器，只把现有能力包成 MCP 工具）。

**全程铁律**（违反即返工，见 [AGENTS.md](../AGENTS.md)）：**每个 MCP 工具 owner-scoped**（API token → ownerId，跨租户 fail-closed）；**只暴露只读/低风险能力**（high_write / 破坏性 / 扣费 / 自治 **永不经 MCP**）；每次 `tools/call` 过**配额 + 限流 + 审计 + 追踪**（span）；**untrusted 入参 zod 校验**，MCP 输出是数据（不当指令）；API token 仍 scrypt 哈希（S12 不变）、不入日志；**复用既有编排/Surface/技能/工作区**（不旁路安全/配额/owner 检查）；线格式与 S11 `HttpMCPClient` 互通（JSON-RPC 2.0）；离线/hermetic 测试（in-process handler + 我们自己的客户端对环，不出网）；改动集中在 `harness-core`(mcp-server)、`apps/bff`(端点)、`apps/web`(连接面板)、`config`(可选目录条目)、`docs`、`evals`；每个能力配测试。

---

## 里程碑 A — MCP Server 核心 + 能力注册表

### S18-T1 · McpServer 协议核心 + CapabilityTool 注册表
- **做**：`harness-core/src/mcp-server/*`：`CapabilityTool`（`name`/`description`/`inputSchema: z.ZodType`/`handler(ownerId, args) => Promise<result>`/`readOnly: true`）。`McpServer`（注册 tools；`handle(rpc, ownerId)`：分发 `initialize`→serverInfo+capabilities、`tools/list`→{name,description,inputSchema(zod→JSON Schema)}、`tools/call`→zod 校验入参→handler→`{ content: [{ type:'text', text }] }`；未知 method / 校验失败 / handler 抛错 → JSON-RPC error）。传输无关、离线。
- **DoD**：单测：initialize 回 serverInfo；tools/list 列出已注册工具 + JSON Schema；tools/call 跑 handler 并返 content；坏入参/未知工具 → 规范 JSON-RPC error；handler 始终带 ownerId。
- **改动**：`harness-core/src/mcp-server/*`（server.ts、types.ts）。
- **依赖**：S11 线格式（参照）。

### S18-T2 · 暴露 Apolla 能力为 MCP 工具
- **做**：把现有能力包成 `CapabilityTool`（owner-scoped）：`apolla.research`（question→报告，跑研究编排到完成）、`apolla.translate`（text,targetLang→译文，接 translate executor）、`apolla.summarize`（text→摘要）、`apolla.run_skill`（name,question→结果）、`apolla.list_skills`、`apolla.workspace_list`、`apolla.workspace_read`（path→内容）。`buildCapabilityTools(harness)` 在 BFF 装配。
- **DoD**：每个工具 owner-scoped 跑通、结构化 I/O；只读/低风险（无写/扣费/自治）；list_skills/workspace_* 只返该 owner 的。
- **依赖**：S18-T1、既有编排/Surface/技能/工作区。

---

## 里程碑 B — 传输 + 鉴权 + BFF 端点

### S18-T3 · BFF `POST /api/mcp` 端点（JSON-RPC + API token）
- **做**：BFF `POST /api/mcp`：读 body（JSON-RPC）→ **`readBearer` 取 ownerId**（无/坏 token → JSON-RPC error / 401）→ `McpServer.handle(rpc, ownerId)` → 返 result/error。线格式与 S11 `HttpMCPClient` 互通（含 `Mcp-Session-Id` 可选）。
- **DoD**：`HttpMCPClient` 指向本地 `/api/mcp` 能 initialize + tools/list + tools/call；无 token → 拒；JSON-RPC 错误规范。
- **依赖**：S18-T1/T2、S12 `readBearer`。

### S18-T4 · 服务端边界治理（owner/配额/安全/审计/追踪）
- **做**：每次 `tools/call`：owner 隔离（仅该 ownerId 数据，跨租户 fail-closed）；**配额门**（MCP 调用计入既有 Quota，超限 → error）；**只读/低风险**断言（注册时 `readOnly`，high_write/破坏性工具一律不注册）；**限流**（复用 per-owner 限流）；**审计**（tool/owner/decision）；**追踪**（每次 call 一个 span，复用 S17，入参不入 span）。
- **DoD**：跨 owner 读他人技能/工作区被拒；配额超限 → error；高风险能力不在 tools/list；MCP 调用落审计 + 有 span；限流生效。
- **依赖**：S18-T3、S10/S16/S17 安全/配额/追踪。

---

## 里程碑 C — 发现/连接体验 + 对环

### S18-T5 · 连接体验（Web 设置面板 + 客户端配置片段）
- **做**：`apps/web` 设置页加 "MCP 端点" 面板：展示端点 URL（`<host>/api/mcp`）+ 如何用 API token 连接 + 一段可粘贴的 MCP 客户端配置（如 Claude Desktop / Cursor 的 server 片段）；列出可用工具（来自 tools/list）。可选：一个公开的 `GET /api/mcp/manifest`（工具目录，不含敏感信息）。
- **DoD**：浏览器：设置页看到端点 + 工具列表 + 配置片段；组件测试。
- **依赖**：S18-T3、S9 前端、S12 token 管理。

### S18-T6 · Dogfood：自己的客户端连自己的服务端
- **做**：用 S11 `HttpMCPClient` 连本地 `/api/mcp`（带 API token）跑 initialize→tools/list→tools/call 对环；可在连接器市场加一条 "Apolla（self）" 条目（指向本地 MCP server）证明 Apolla 能把自己当外部工具用。
- **DoD**：集成测试：`HttpMCPClient` ↔ Apolla MCP Server 对环通过（协议互通）；（可选）self 连接器在 Agent 工具集出现。
- **依赖**：S18-T3/T4、S11 客户端。

---

## 里程碑 D — 质量闸门

### S18-T7 · Eval/测试扩展
- **做**：McpServer 单测（initialize/list/call/error）；BFF `/api/mcp` HTTP 集成（鉴权、owner-scoped、JSON-RPC error）；各能力工具 happy path + owner 隔离；配额/安全（高风险不暴露、超限 error）；**client↔server 对环**（HttpMCPClient ↔ /api/mcp）；可加 1 项 eval（MCP tools/list+call owner-scoped）。全程 hermetic（in-process + 自客户端，不出网）。
- **DoD**：`pnpm test` + `pnpm e2e` 全绿且 hermetic；故意破坏（无鉴权/跨租户/暴露高风险/不校验入参）任一即变红。
- **依赖**：S18-T1…T6。

### S18-T8 · 文档回写
- **做**：README（MCP Server：端点、API token 连接、暴露哪些工具、接 Claude Desktop/Cursor、只读边界）；ARCHITECTURE（§ 适配器矩阵/开放生态加 "Apolla as MCP Server"；S11 客户端 ↔ S18 服务端对偶；数据流 tools/call→能力→owner/配额/审计/追踪）；CLAUDE/AGENTS（MCP server 铁律）；Sprint 18 DoD 勾选。
- **DoD**：新人照 README 用 token 把本地 Apolla 接进一个 MCP 客户端跑通；文档准确。
- **依赖**：S18-T1…T7。

---

## 执行顺序与并行建议

```
S18-T1(McpServer 核心) ─ S18-T2(能力→工具) ─ S18-T3(/api/mcp + 鉴权) ─┬─ S18-T4(治理)
                                                                      ├─ S18-T5(连接面板)
                                                                      └─ S18-T6(对环 dogfood)
                                                          全部收口 → S18-T7(测试) → S18-T8(Docs)
```
- **关键路径**：S18-T1（协议核心）→ S18-T2（能力包装）→ S18-T3（端点+鉴权）是地基；治理/面板/对环在其上并行。
- **每完成一个任务**：跑该模块测试 + 既有回归 + `pnpm e2e`；一任务一 PR，CI 绿即合。
- **建议 PR 分组**：A(T1+T2) · B(T3+T4) · C(T5+T6) · D(T7+T8)。

## Sprint 18 Definition of Done（整体验收）
- [x] `McpServer` 协议核心（initialize/tools/list/tools/call + JSON-RPC error）+ `CapabilityTool` 注册表。
- [x] Apolla 能力暴露为 MCP 工具（研究/翻译/总结/技能/工作区读），owner-scoped、只读/低风险。
- [x] `POST /api/mcp`（JSON-RPC + API token 鉴权），与 S11 `HttpMCPClient` 互通。
- [x] 治理：owner 隔离 + 配额 + 限流 + 审计 + 追踪；高风险不暴露；入参 zod 校验。
- [x] 连接面板（端点 + token 用法 + 客户端配置片段 + 工具列表）。
- [x] Dogfood：`HttpMCPClient` ↔ Apolla MCP Server 对环通过。
- [x] `pnpm test` + `pnpm e2e` 全绿且 hermetic。
- [x] README/架构文档更新。

> **Sprint 18 完成**（PR [#101](https://github.com/Timsunzhuping/ApollaAIStudio/pull/101) A · [#102](https://github.com/Timsunzhuping/ApollaAIStudio/pull/102) B · [#103](https://github.com/Timsunzhuping/ApollaAIStudio/pull/103) C · D 本次）。S11（MCP 客户端）的对偶：Apolla 成为 **MCP Server**。`McpServer`（harness-core，传输无关 JSON-RPC）+ `CapabilityTool`/`defineTool` 注册表；`buildCapabilityTools` 把 `apolla.research`/`translate`/`summarize`/`run_skill`/`list_skills`/`workspace_list`/`workspace_read` 包成 owner-scoped 只读工具（背后接既有编排/Surface/技能/工作区）；`POST /api/mcp`（JSON-RPC，API token 鉴权复用 `readBearer`，与 S11 `HttpMCPClient` 互通）+ `GET /api/mcp/manifest` 公开目录；治理：owner 隔离 + 配额 + 限流 + 审计 + 追踪、只读/低风险、入参 zod 校验；设置页 "MCP server" 面板；dogfood（自 `HttpMCPClient` ↔ 自 server）。新增 eval `mcp-server-contract`（40）。298 root + 8 skip + 22 web + 9 e2e 绿。MCP resources/prompts/sampling、streamable-HTTP、MCP OAuth、写能力暴露列为后续。

## 风险与提示（给代理）
- **只读/低风险是底线**：MCP 只暴露只读/低风险能力；写/扣费/破坏/自治（媒体生成、连接器写、工作区写、cowork）**永不**注册为 MCP 工具。注册表上 `readOnly` 显式标注。
- **owner 隔离不可破**：API token → ownerId；每个工具只碰该 owner 数据；跨租户 fail-closed（list_skills/workspace_* 尤其）。
- **复用既有路径**：研究/Surface/技能/工作区都走既有编排/runtime，自动继承安全/配额/审计/追踪——别为 MCP 另写一条绕过治理的捷径。
- **线格式互通**：参照 S11 `HttpMCPClient`/`StubHttpMcpServer` 的 JSON-RPC 2.0；用我们自己的客户端对环自测（协议真互通的最强证据）。
- **入参 untrusted**：每个工具入参 zod 校验；MCP 调用方不可信；校验失败 → 规范 JSON-RPC error，不抛裸异常。
- **配额/限流计入**：MCP 的 `tools/call` 与 HTTP 同等计配额 + 限流（防止 token 绕过 UI 刷量）。
- **长任务诚实**：研究类工具同步跑到完成、延迟较大——本 Sprint 接受并标注；streamable/异步 job 化留后续。
- **不确定/不可逆**（端点路径、initialize capabilities 声明、工具命名前缀 `apolla.`、错误码、manifest 是否公开）→ 选保守默认并在 PR 标注。
