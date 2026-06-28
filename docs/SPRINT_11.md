# Sprint 11 执行单 — Open Tool Ecosystem：HTTP/SSE MCP transport + 连接器市场

> 读者：**Codex / Claude Code**。逐任务从上往下执行；每个任务自带验收（DoD）、依赖、改动位置。
> 前置必读：[ARCHITECTURE.md](./ARCHITECTURE.md) §3.4 · [AGENTS.md](../AGENTS.md) · `packages/harness-core/src/tools/mcp.ts`（`MCPClient`/`MCPSession`/`wrapMCPTool`/`inferRisk`）· `packages/adapters/mcp`（现有 stdio 客户端）· Sprint 01–10（已完成）。
> 目标产物（Sprint Demo）：**从连接器市场一键添加一个托管 MCP 服务（HTTP transport）→ 枚举其工具 → 在 Agent/Cowork 中调用（远程工具输出走数据通道、低风险写入需确认）→ 审计可见。** 全程离线确定性（内置 stub HTTP MCP server），全链路走 Harness Core，不旁路。

## 0. Sprint 范围与非目标

**主题**：连接器契约早已声明 `transport: 'http'`，但 BFF 只实现了 `stdio` + `stub`——**整个托管 MCP 生态（Streamable HTTP，当下 MCP 服务的标准部署方式）尚不可达**。本 Sprint 补上 **HTTP/SSE MCP transport**，并加一个**连接器市场**让工具可发现、一键接入。这是 harness 杠杆的直接放大：平台能力 = 可插拔工具的并集，远程 MCP 打开了这个并集的上限。复用既有 `MCPClient`/`MCPSession` 接口 + `wrapMCPTool` + `inferRisk` + ToolRuntime + Safety 三级 + 审计，不另造执行通道。

**做（本 Sprint 的闭环）**
- HTTP/SSE MCP 客户端：实现 `HttpMCPClient`（JSON-RPC over HTTP POST；接受 JSON 或 SSE 响应），实现 `MCPClient`/`MCPSession`（connect/initialize → listTools → callTool → close）。内置 `StubHttpMcpServer`（进程内 node:http）供离线契约测试。
- 远程连接器：连接器 `transport='http'` 携带 `url` + 鉴权头（token 来自**加密 secrets**，仅发往配置的 host）；连接时枚举远程工具，风险**保守推断**（远程工具默认 low_write，除非 readOnly 注解/配置）；超时 + 不可达隔离（跳过该连接器，不让 Agent 崩）。
- 连接器市场：声明式目录 `config/connectors/*.json`（name/描述/transport/url 模板/所需 secrets/主页）+ `loadConnectorCatalog()`；BFF `GET /api/connectors/catalog` + 一键"从目录添加"（预填配置，用户补 secrets）。
- 市场 UI：`apps/web` 浏览目录、添加连接器（填 url/secrets）、查看已装连接器 + 工具 + 健康；并入 Agent 页连接器区。
- 安全与韧性：远程工具输出 untrusted（数据通道）；远程调用**限时 + 计入限流**；secrets 不外泄到非配置 host；远程 high_write 不自动授予；连接器健康探针（可达性 + 工具数）+ 指标；失败隔离；远程调用落审计。
- 质量闸门：HTTP MCP 客户端契约测试（打内置 stub server）、远程连接 connect→list→call、untrusted 输出、超时/不可达、目录加载、市场 UI 组件测试；文档/Demo。

**不做（留待 Sprint 12+）**
- MCP 的 **OAuth 授权流**（远程鉴权本 Sprint 仅 token/header）；MCP `resources`/`prompts`/`sampling`（本 Sprint 只做 **tools**，与现有 ToolRuntime 对齐）。
- 任意远程代码执行沙箱、Plugin/连接器市场的计费/评分/审核流。
- 浏览器扩展、OAuth/SSO 登录、e2e 浏览器测试、分布式队列（各自专题 Sprint）。

**全程铁律**（违反即返工，见 [AGENTS.md](../AGENTS.md)）：远程工具输出**永远是 untrusted 数据**（数据通道，不当指令）；工具风险来自**声明**（连接器配置/注解），不来自输出；远程工具默认 low_write（需确认/预授权），**绝不自动 high_write**；secrets **加密存储**、仅随请求发往**配置的 host**、不入日志/不回显；远程调用**限时**（超时即失败，不挂起）+ 计入限流 + 落审计；不可达连接器**隔离跳过**（不崩 Agent/Cowork）；market 目录是声明式配置，新增条目不改业务代码；改动集中在 `packages/adapters/mcp`(+可能新 `mcp-http`)/`harness-core`/`config`/`apps`/`evals`；每个能力配测试/eval。

---

## 里程碑 A — HTTP/SSE MCP transport

### S11-T1 · HttpMCPClient（JSON-RPC over HTTP，SSE 兼容）
- **做**：实现 `HttpMCPClient`（实现 `MCPClient`）：`connect(server)` → `initialize` 握手 → 返回 `MCPSession`（`listTools` 走 `tools/list`、`callTool` 走 `tools/call`、`close`）。请求 = JSON-RPC over HTTP POST 到 `server.url`；响应支持 `application/json` 或 `text/event-stream`（SSE，取最终结果帧）。注入 `fetch` 以便测试。内置 `StubHttpMcpServer`（进程内 node:http，JSON-RPC）供离线测试。
- **DoD**：契约测试：连内置 stub HTTP server → `listTools` 返回工具 → `callTool` 返回结果（JSON 与 SSE 两种响应都通过）；非 2xx/超时 → 抛错（不挂起）。
- **改动**：`packages/adapters/mcp/src/http.ts`（或新包 `@apolla/mcp-http`）、导出。
- **依赖**：现有 `MCPClient`/`MCPSession` 接口。

### S11-T2 · 远程连接器接入 + 鉴权 + 韧性
- **做**：BFF `mcpClientFor('http')` 返回 `HttpMCPClient`。连接器 `transport='http'` 用 `url` + 鉴权头（如 `Authorization: Bearer <secret>`，secret 经 AES-GCM 解密、仅发往该 url 的 host）。连接时枚举远程工具 → `wrapMCPTool` + `inferRisk`（保守）。**超时**（如 10s/可配）+ 不可达 → 跳过该连接器（沿用现有 try/catch 隔离）。远程调用计入限流 + 审计。
- **DoD**：添加一个 http 连接器（指向 stub server）→ 工具出现在 Agent 工具集；远程 low_write 需确认；不可达连接器不影响其他工具/不崩；远程调用落审计。
- **依赖**：S11-T1、Sprint 04 连接器/加密 secrets、Sprint 10 限流/审计。

---

## 里程碑 B — 连接器市场

### S11-T3 · 市场目录 + 一键添加
- **做**：声明式目录 `config/connectors/*.json`（id/name/description/transport/urlTemplate/requiredSecrets[]/homepage）+ `loadConnectorCatalog()`。BFF `GET /api/connectors/catalog`（列目录）+ `POST /api/connectors/from-catalog {id, url?, secrets}`（按目录项创建连接器，secrets 加密存储）。内置 1–2 个示例条目（指向内置 stub / 公开 echo）。
- **DoD**：列目录；从目录一键添加 → 连接器创建 + 工具枚举；新增目录条目无需改业务代码；缺必填 secret 时报清晰错。
- **依赖**：S11-T2。

### S11-T4 · 市场 UI
- **做**：`apps/web` Agent 页连接器区升级：**浏览目录**（卡片：名称/描述/所需 secrets）→ 添加（填 url/secrets）→ 已装连接器列表（工具数 + 健康 + 启停/删）。
- **DoD**：浏览器里浏览目录 → 添加一个 http 连接器 → 看到其工具 → 在 Agent/Cowork 调用；组件测试覆盖目录渲染 + 添加流（mock fetch）。
- **依赖**：S11-T3、Sprint 09 前端。

---

## 里程碑 C — 安全与韧性

### S11-T5 · 远程工具安全
- **做**：远程工具输出 untrusted（已是数据通道，加测试钉死）；远程 high_write 不自动授予（`inferRisk` 已保证，加测试）；secrets 仅发往配置 host、不入日志/不回显（审计/日志脱敏校验）；远程调用计入 per-owner 限流（Sprint 10）。
- **DoD**：单测：远程工具输出进数据通道不改 tiering；注入式远程输出（"忽略指令"）不改变行为；secrets 不出现在审计/日志/响应；远程调用受限流。
- **依赖**：S11-T2、Sprint 10 安全。

### S11-T6 · 连接器健康 + 可观测性
- **做**：连接器健康探针（connect + listTools → 可达?/工具数/延迟），BFF `GET /api/connectors/:id/health`；失败隔离不崩；远程调用计入 `Metrics`（计数 + 延迟 + 错误率）。UI 显示健康徽标。
- **DoD**：健康端点对可达/不可达分别返回 ok/不可达；指标累计远程调用数/错误；UI 显示徽标；单测覆盖探针 ok 与失败路径。
- **依赖**：S11-T2、Sprint 10 可观测性。

---

## 里程碑 D — 质量闸门

### S11-T7 · Eval/测试扩展（远程工具）
- **做**：HTTP MCP 客户端契约测试（JSON + SSE 响应、错误/超时）；远程连接 connect→list→call 端到端（打内置 stub）；untrusted 输出 + 注入不升级；目录加载；健康探针 ok/失败；市场 UI 组件测试。可加 1 项 eval：远程工具经 Agent 调用的端到端（stub）。CI 离线确定性。
- **DoD**：`pnpm test` + `pnpm test:web`（+ 如加则 `pnpm eval`）覆盖以上；CI 全门禁绿；故意破坏（远程输出当指令 / 远程自动 high_write / secret 入日志 / 不可达崩溃）任一即变红。
- **依赖**：S11-T1…T6。

### S11-T8 · 文档回写 + Demo
- **做**：更新 README（远程 MCP/市场：如何添加 http 连接器、目录、所需 env/secrets）/ARCHITECTURE（§3.4 transport 矩阵 + 市场）/CLAUDE/AGENTS。Demo 端到端（离线 stub 可演示），Sprint 11 DoD 勾选。
- **DoD**：新人按 README 添加一个 http 连接器并在 Agent 调用；文档与实现一致；Demo 离线走通。
- **依赖**：S11-T1…T7。

---

## 执行顺序与并行建议

```
S11-T1(HttpMCPClient) ─ S11-T2(远程连接器接入) ─┬─ S11-T3(市场目录) ─ S11-T4(市场 UI)
                                                ├─ S11-T5(远程安全)
                                                └─ S11-T6(健康/可观测)
                              全部收口 → S11-T7(Eval/测试) → S11-T8(Docs/Demo)
```
- **关键路径**：S11-T1（HTTP 客户端 + stub server）→ S11-T2（接入）是地基；市场/安全/健康在其上并行。
- **每完成一个任务**：跑该模块测试 + 相关回归；一任务一 PR，CI 绿即合；提交说明写清「动了哪个 transport/端点 + 加了哪个测试」。
- **建议 PR 分组**：A(T1+T2) · B(T3+T4) · C(T5+T6) · D(T7+T8)。

## Sprint 11 Definition of Done（整体验收）
- [ ] HTTP/SSE MCP 客户端：JSON-RPC over HTTP（JSON + SSE 响应）、initialize/list/call/close、超时不挂起；内置 stub server 契约测试通过。
- [ ] 远程连接器：transport='http' 用 url + 加密 token（仅发配置 host）；工具枚举 + 保守风险；不可达隔离不崩；远程调用计限流 + 审计。
- [ ] 市场：声明式目录 + 一键添加；新增条目零业务代码改动；缺 secret 报清晰错。
- [ ] 市场 UI：浏览目录 → 添加 → 工具可见 → Agent/Cowork 调用。
- [ ] 安全：远程输出 untrusted 不升级、远程不自动 high_write、secrets 不入日志/响应、远程调用受限流。
- [ ] 健康/可观测：连接器健康端点 + 指标 + UI 徽标；失败隔离。
- [ ] `pnpm test` + `pnpm test:web` 覆盖客户端契约/远程端到端/安全/健康/市场；CI 全门禁绿。
- [ ] README/架构文档更新；Demo 离线可演示（内置 stub server）。

## 风险与提示（给代理）
- **远程输出永远 untrusted**：与本地工具一视同仁进数据通道；风险来自声明不来自输出；远程绝不自动 high_write。
- **secrets 纪律**：加密存储、仅随请求发往**配置的 host**、不入日志/审计/响应/指标；探针/错误信息也脱敏。
- **限时 + 隔离**：远程调用必须有超时；不可达/超时 → 失败或跳过，绝不挂起 Agent/Cowork（沿用现有 connectMCP try/catch 隔离）。
- **离线可测**：用进程内 `StubHttpMcpServer`（node:http，端口 0）做契约/端到端测试；注入 fetch；CI 不出网。
- **复用既有抽象**：只实现 transport（`MCPClient`/`MCPSession`）；`wrapMCPTool`/`inferRisk`/ToolRuntime/Safety/审计/限流全部复用，不重写。
- **只做 tools**：本 Sprint 不碰 MCP resources/prompts/sampling；与当前 ToolRuntime 对齐，避免范围蔓延。
- **不确定/不可逆**（超时默认、SSE 帧取舍、目录字段）→ 选保守默认并在 PR 标注。
