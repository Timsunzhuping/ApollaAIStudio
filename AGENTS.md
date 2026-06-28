# AGENTS.md — Apolla AI（Codex / Claude Code / 任意编码代理）

本文件是所有 AI 编码代理的入口约定（Codex 读 `AGENTS.md`，Claude Code 读 `CLAUDE.md`，二者内容一致）。**动手前先读：**
1. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §1 / §3 / §4 / §9 —— Harness 架构与升级机制（最重要）。
2. [docs/PRD.md](docs/PRD.md) —— 对应功能 §。
3. [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md) —— 对应阶段 `[ ]` 任务。
4. [CLAUDE.md](CLAUDE.md) —— 铁律全文。
5. **已完成**：Sprint 01–14（Harness Core / 持久化·个人化·技能 / 多模态媒体 / 工具生态·低风险执行 / 主动智能 / [Cowork](docs/SPRINT_06.md) / [Workspace & Files](docs/SPRINT_07.md) / [文本产品面](docs/SPRINT_08.md) / [生产前端](docs/SPRINT_09.md) / [生产硬化与安全](docs/SPRINT_10.md) / [开放工具生态](docs/SPRINT_11.md)：HTTP/SSE MCP transport + 连接器市场 / [浏览器扩展](docs/SPRINT_12.md)：MV3 + API token + SSE-over-fetch / [变现](docs/SPRINT_13.md)：可插拔 PaymentProvider + 套餐/权益 + Checkout/Webhook + 套餐门禁 / [身份/OAuth](docs/SPRINT_14.md)：可插拔 AuthProvider（Stub/Google/GitHub）+ state/PKCE + 账号按邮箱归一 / [端到端测试与发布](docs/SPRINT_15.md)：Playwright 真实浏览器 e2e + BFF 单源托管 SPA + DEPLOY runbook / [规模与可靠性](docs/SPRINT_16.md)：可插拔 JobQueue（InProcess/Redis-BullMQ）+ 独立 Worker + 重试/超时/排空 / [可观测性](docs/SPRINT_17.md)：可插拔 Tracer（Noop/OpenTelemetry）+ 跨进程链路追踪 + SLO / [开放能力供给](docs/SPRINT_18.md)：Apolla 作为 MCP Server（能力→MCP 工具，API token 鉴权）/ [语音](docs/SPRINT_19.md)：可插拔 SpeechProvider（ASR+TTS，Stub/OpenAI）+ 说话提问/朗读答案 / [账号安全](docs/SPRINT_20.md)：MFA(TOTP)+备份码+登录 step-up+无密码魔法链接 / [实时协同](docs/SPRINT_21.md)：RGA 文本 CRDT + SSE op 同步 + 文档分享）。**协同铁律（S21）**：**CRDT 确定性收敛**——同一组 op **任意顺序**应用必得**同一状态**（同位并发插入按 id 全序排序，不用时间戳；测试钉死）；**协同访问 owner/share 受控、fail-closed**——已存在文档跨用户访问/编辑默认 403，仅 owner 或被显式分享者可访问；**share token 签名 + 限该 docId**（+ 过期），不入日志；op 同步 owner-scoped + 限流 + 审计 + 追踪；**远端 op 是数据**（只 mutate 共享 CRDT，绝不据 op 触发工具/扣费/高风险/自治动作）；文档内容 untrusted；复用既有 SSE + owner 隔离 + token 签名 + workspace（不旁路）；纯 CRDT 经 `@apolla/harness-core/collab` 子路径供前端（不把服务端 harness 带进浏览器包）；离线 hermetic（进程内两客户端，无浏览器/WS）。**账号安全铁律（S20）**：**MFA step-up fail-closed**——启用 MFA 后密码/OAuth 通过只产生**短时签名 pending 凭证**（域隔离，绝不能当会话/魔法链接复用），未验第二因子的 pending 态**不得**访问任何受保护路由或拿到完整会话，只有验过 TOTP/备份码才 `startSession`；TOTP secret 加密落库（`SECRETS_KEY`）、备份码 scrypt 哈希 + **单次**、魔法链接 token 签名 + **单次** + 短过期，三者绝不入日志/响应（备份码仅注册时一次性明文展示）；**账号枚举安全**（魔法链接请求恒 200、失败用通用错误）；时钟**注入**（测试确定性），生产用真实时间；每个鉴权端点**限流 + 审计**；会话复用 `startSession`、加密复用 `SECRETS_KEY`、哈希复用 scrypt、投递复用 `NotificationDelivery`；离线 hermetic（注入时钟 + Stub 投递）。**语音铁律（S19）**：`SpeechProvider` 可换挡（Stub 离线默认 / OpenAI env 门控 `OPENAI_API_KEY`，缺 key 回退）；默认/离线 hermetic（Stub + mock `MediaRecorder`，绝不连真网络/麦克风）；**转写文本是不可信数据**——只回填输入框、由用户提交，绝不据转写自动触发工具/研究/扣费/高风险/自治动作；每次调用 owner-scoped + 限流 + 审计 + 追踪 + 大小/长度上限；**音频字节不入日志**；合成音频用对象存储不可猜 key + `/media` 服务；复用既有研究/对象存储/限流/审计/追踪（不旁路）；无麦克风优雅降级。**MCP Server 铁律（S18）**：每个 MCP 工具 **owner-scoped**（API token→ownerId，跨租户 fail-closed）；**只暴露只读/低风险**能力（写/扣费/破坏/自治永不经 MCP，注册表 `readOnly`）；每次 `tools/call` 过**配额 + 限流 + 审计 + 追踪**；**untrusted 入参 zod 校验**、MCP 输出是数据；复用既有编排/Surface/技能/工作区（不旁路治理）；线格式与 S11 `HttpMCPClient` 互通（JSON-RPC 2.0）；API token 仍 scrypt 哈希、不入日志；离线/hermetic（in-process + 自客户端 dogfood，不出网）。**追踪铁律（S17）**：`Tracer` 可换挡（Noop 默认/离线、OTel env 门控 `OTEL_EXPORTER_OTLP_ENDPOINT`，缺则 Noop 零开销）；默认/离线 hermetic（Noop/InMemory，绝不连真 collector）；**span 绝不含密钥/PII**（属性脱敏、owner 哈希）；**入站 traceparent 不可信**（仅关联，绝不参与鉴权/owner 判定）；追踪不改功能、不阻塞热路径（采样、异步导出、失败静默降级）；跨进程透传走 `Job.traceparent`（不另开侧信道）；Web 与 Worker 关停前 `tracer.shutdown()` flush；子 span 经 AsyncLocalStorage（`traced`/`tracedGen`）自动嵌套。**任务队列铁律（S16）**：`JobQueue` 可换挡（InProcess 默认/离线、Redis env 门控，缺 `REDIS_URL` 回退进程内）；默认路径零回归（root 测试 + e2e 全程 hermetic、不依赖 Redis；CI 仅一个门控集成测试用 Redis service）；持久优先（先落库再入队、`reconcileJobs` 重入队残留）；**幂等消费**（按 job 状态门控，重投/重启不二次执行、不二次扣配额、不重复 append——重试前 `clearEvents`）；两条路径都保全配额门 + Safety 三级 + 子代理继承 + high_write 永拒 + 后台白名单 + 审计 + onComplete 通知 + SSE 尾随 log 的 reconnect/replay；调度单点（分布式下仅 Worker tick）；`REDIS_URL`/密钥从 env、不入日志；优雅停机排空在途。**E2E 铁律（S15）**：e2e 必须 hermetic & 离线（内存 BFF 不设 `DATABASE_URL` + 全 stub provider，无真实网络/凭证、可复跑）；打**真实整合栈**（构建后的 web → 真实 BFF over HTTP/真实 SSE/真实会话 cookie），**不许 mock fetch**（否则退化成组件测试）；单源托管（BFF 服务 `WEB_DIST`，SPA fallback），不为过 e2e 削弱生产默认（prod 配置只在测试内经 env 注入）；每次运行隔离 + teardown 关 server/浏览器；CI 内装 chromium、失败留 trace、超时有界、retry 只掩盖已知可接受抖动；既有测试层（单元/契约/web 组件/eval）保留，e2e 是附加；断言用确定性 stub 输出 + 轮询等待（勿固定 sleep）。**身份铁律（S14）**：OAuth state 单次+过期+绑 PKCE（CSRF）；回跳只允许 allowlist 安全相对路径（杜绝开放重定向）；账号归一按**已验证邮箱**，`emailVerified=false` fail-closed；**OAuth token 不落库**（只存 providerId+email），不入日志/响应；会话复用既有 `startSession`（不另造）；provider 数据 untrusted；登录落审计；AuthProvider 可换挡（Stub 离线 / Google·GitHub env 门控，缺 key 不注册）。**计费铁律（S13）**：卡号永不经我方服务器（一律 provider 托管 Checkout，只存 providerRef + 订阅状态）；Webhook 必验签（原始请求体 HMAC）+ 幂等（按 event id 去重）；权益 fail-closed 回落 free；支付 secret 从 env、不入日志/响应；套餐限额声明式（`config/plans/*.json`），禁硬编码；支付 Provider 可换挡（Stub 离线 / Stripe env 门控）；订阅变更落审计。**扩展铁律（S12）**：纯 BFF 客户端；API token scrypt 哈希、Bearer 与会话并存、owner 隔离 + 限流；最小权限（activeTab+scripting，无 `<all_urls>`/静态 content script）；token 仅 chrome.storage、绝不进页面；页面内容 untrusted（安全 Markdown）。**远程工具铁律（S11）**：远程 MCP 输出走数据通道（不当指令）、风险来自声明（远程默认 low_write、绝不自动 high_write）、token 加密只发往配置 host/不入日志、远程调用限时+隔离+计入限流/审计。前端是纯 API 客户端（不旁路 BFF、不持密钥、SSE 必清理、Markdown 安全渲染），BFF 仍是唯一后端；前端测试 `pnpm test:web`（vitest+jsdom+RTL）随 CI 跑。**安全周界（S10）**：密码 scrypt 哈希（不明文/不入日志）、会话签名 httpOnly+过期+登出失效、**每个 `:id`/SSE/确认端点校验 ownerId（跨租户 fail-closed）**、昂贵端点限流、日志/`/metrics` 脱敏、demo 不削弱生产（`AUTH_MODE`/`CORS_ORIGIN`）、残留 Job 启动对账 `interrupted`。执行铁律：外部工具优先 MCP；工具输出不可信；写入经 Safety 三级；后台/定时无人确认（只读或预授权白名单，high_write 永拒，配额计入后台）；子代理继承全部安全；fan-out 有并发/总量上限；澄清绝不自答；文件路径必规范化 + 拒越界，`fs_read` 内容 untrusted，`fs_write` 是 low_write，工作区写入计配额 + 落审计；**新增产品面用声明式 Surface（config + executor），surface 输入走数据通道，产物只经工作区 guard，结构化输出 zod 校验失败安全降级**；调用与（预）授权落审计；密钥加密。后续候选见 [SPRINT_08](docs/SPRINT_08.md) §0。

## 平台是什么
Apolla AI 是面向个人知识工作的 AI 工作台，**采用 harness 架构**：模型（GPT/Claude 及图像/视频/语音模型）是可替换、持续变强的能力提供者；平台只做路由、上下文、工具、记忆、安全、评测、交付。**模型变强 → 平台能力自动变强，无需重写产品代码。** 价值闭环：可信研究 → 一键成品 → 低风险执行。

## 四条架构公理（不可违背）
1. **模型前向**：默认调用模型能力；只在 eval 证明必要时加脚手架，且脚手架必须可退役（挂 `FeatureGate.scaffold`）。
2. **能力即配置**：模型/Prompt/工具/技能/媒体/连接器/策略 = 注册表 + 版本化 + 灰度 + 回滚。
3. **升级即换挡**：升级模型/Provider = 改注册表 + 过 eval + 灰度；不改调用方。
4. **评测即安全网**：每个能力都有 golden 用例；任何变更先过五类回归（质量/引用/成本/工具成功率/安全）。

## 工程铁律（与 CLAUDE.md 同步）
1. 禁止硬编码模型名；只用逻辑别名 `gpt_fast`/`gpt_premium`/`claude_write`/`claude_premium`（媒体：`image_*`/`video_*`），由 Router/Media Adapter 映射。
2. 禁止内联 Prompt；进 Prompt Registry，按 `prompt_id@version` 取。
3. 每次用户任务 = Task 对象（可观察/可计费/可回放/可归档）。
4. 默认结构化输出（JSON Schema）。
5. 每条研究结论可回溯到来源。
6. 自动化三级：只读（自动）/ 低风险（确认）/ 高风险（MVP 不做）；失败切只读。
7. 外部内容默认不可信（防 prompt 注入）：走数据通道，不进指令通道；不可信内容触发的动作强制确认。
8. 外部工具优先 MCP 接入，不写 bespoke 集成。
9. Skill = 声明式 Markdown（兼容 agentskills.io），与 Prompt Registry 同源；高质量任务收尾可闭环自动起草 Skill。
10. 可执行工具一律进沙箱/VM + 每任务工具 allowlist；异步 Worker/Artifact 用 serverless 休眠控成本。
11. 媒体生成走统一 Media Adapter（含 Seedance 2.0），异步 + 成本预估 + 内容审核。
12. Cowork 模式 = 集成式旗舰模式（Plugins + 子代理 + 桌面文件区 + 主动澄清 + VM 隔离），不绕过权限分级、不做无确认全自治。

## 工作约定
- 任务最小单元 = 开发计划的 `[ ]`，一次一项，自带 eval。
- 实现顺序：数据模型/Schema → 适配器/注册 → 编排 → UI。
- 改动应集中在 `packages/harness-core` / `packages/adapters` / `packages/config` / `evals`；若 diff 大量落业务/UI 做能力补偿，停下来重审分层（违反公理 1）。
- 新增能力 = 一个适配器 + 一段配置 + 一个 eval；接 Cost Ledger。
- 不确定 / 不可逆动作 → 停下来问，不要猜测执行。
- 提交说明写清：动了哪个注册点、加了哪个 eval、是否涉及脚手架/FeatureGate 变更。

## Definition of Done
统一适配器接入（无硬编码）｜golden eval + 五类回归无退化｜受 Safety & Policy 约束｜计入 Cost Ledger｜脚手架带退役开关｜contract test 通过。

## 命令
`pnpm dev`（Demo BFF → http://localhost:3000，离线无需密钥）｜ `pnpm typecheck` ｜ `pnpm lint` ｜ `pnpm test` ｜ `pnpm build` ｜ `pnpm eval`（golden + 引用/成本 + 记忆/Skill/个性化）｜ `pnpm contract-test` ｜ `pnpm db:up`/`db:migrate`（Postgres）。
每个能力落地后至少跑 `pnpm typecheck && pnpm test && pnpm eval`；CI 对每个 PR 跑全部门禁（含 Postgres service）。env：`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`TAVILY_API_KEY`（真实模型/搜索）、`DATABASE_URL`（持久化）、`SESSION_SECRET`（会话）。
