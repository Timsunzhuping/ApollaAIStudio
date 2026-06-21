# Sprint 05 执行单 — 主动智能：定时任务 + 后台自治运行 + 通知

> 读者：**Codex / Claude Code**。逐任务从上往下执行；每个任务自带验收（DoD）、依赖、改动位置。
> 前置必读：[ARCHITECTURE.md](./ARCHITECTURE.md) §1/§3.9/§4/§9 · [AGENTS.md](../AGENTS.md) · [PRD.md](./PRD.md) §5/§7/§15 · Sprint 01–04（已完成）。
> 目标产物（Sprint Demo）：**把一次研究/Agent 任务存成「每天早报」定时任务 → 调度器到点在后台自动运行 → 运行历史与产物可查 → 完成后收到站内通知 → 断连重连仍能看到结果 → 重启后定时任务与历史仍在。** 后台运行的 Agent 默认只读、不自我确认；高风险永拒。全链路走 Harness Core，不旁路。

## 0. Sprint 范围与非目标

**主题**：把平台从「按需请求-响应」升级为「**主动/自治**」——任意 orchestrator（research/media/agent/skill）可作为**后台 Job** 异步运行（断连不影响、可重放、可查），并能按 **cron 定时**自动触发；结果经**通知/信息流**送达。这是 PRD §5 Scheduled Tasks（v1）的落地，也是 Cowork（§15）「后台自治工作」的自治底座。

**做（本 Sprint 的闭环）**
- 后台运行时：把 orchestrator 运行作为 `Job`（async、事件持久化为可回放 run-log、状态机），与 HTTP 请求解耦；Job 列表/详情/重连重放。
- 定时调度：内置 cron 调度器（无外部依赖）→ 到点触发 Job；`ScheduledTask`（持久化、按 owner、可启停）。
- 定时模板：把一个 skill/agent/研究配置 + 输入存成定时任务（如「每日早报」「每周竞品监控」）。
- 通知与信息流：Job 完成/失败 → 通知（站内 feed + 可插拔 webhook/email stub）；未读/已读；收件箱/历史 UI。
- 后台执行安全：后台/定时运行**无人在场**——Agent 不得自我确认；默认只读，或按**预授权工具白名单**（上限 low_write，high_write 永拒）；配额计入后台运行。
- 质量闸门：调度触发 / 后台完成与重放 / 通知投递 / 只读调度不写入 的 eval；文档 + Demo。

**不做（留待 Sprint 06+）**
- Cowork 模式整合（Plugins 打包 + 子代理编排 + 桌面文件区）——本 Sprint 只做其自治底座。
- 文本产品面（翻译/Writer/Sheets/Meeting Notes）、浏览器扩展/执行、生产级 Next.js 前端、HTTP/SSE MCP transport、连接器市场、高风险自动化。
- 分布式/持久化队列（先用进程内调度 + Postgres 状态；生产可后置换 durable queue）。

**全程铁律**（违反即返工，见 [AGENTS.md](../AGENTS.md)）：后台/定时运行**禁止自我确认低风险写入**——要么只读、要么预授权白名单（上限 low_write），**高风险永拒**；工具输出默认不可信；每次后台工具调用与（预）授权落审计；Job/调度/通知按 owner 隔离、可删；改动集中在 `harness-core`/`adapters`/`config`/`evals`/`apps`；每个能力配 eval。

---

## 里程碑 A — 后台运行时

### S5-T1 · Job 运行时（orchestrator → 后台 Job）
- **做**：`harness-core/src/jobs/*`。`JobRunner.start(spec)`：把任意 orchestrator 运行（research/media/agent/skill）作为后台 `Job` 执行（async，不阻塞请求）。`Job`（id/ownerId/kind/input/status: queued→running→done|failed/createdAt）。运行中把事件追加到持久化 **run-log**（可回放）。`JobRepository`（内存 + Postgres）。
- **DoD**：`start` 立即返回 jobId；后台运行至 done/failed；`Job` + run-log 持久化、按 owner 隔离；断开「调用者」不影响完成。
- **改动**：`harness-core/src/jobs/*`、`contracts`（Job/JobEvent）、`db-postgres`。
- **依赖**：Sprint 01–04 orchestrators。

### S5-T2 · Job API + 重连重放
- **做**：BFF：`POST /api/jobs`（建后台 Job）、`GET /api/jobs`（列表）、`GET /api/jobs/:id`（详情+状态）、`GET /api/jobs/:id/events`（SSE：**先重放已持久化事件，再续接实时**）。
- **DoD**：curl：建 Job → 断开 → 重新 `:id/events` 能看到从头的完整事件直到 done；列表/详情正确；按 owner 鉴权。
- **依赖**：S5-T1。

---

## 里程碑 B — 定时调度

### S5-T3 · Cron 调度器
- **做**：`harness-core/src/schedule/*`。内置轻量调度器（进程内 tick + cron 解析，无外部依赖；时钟可注入便于测试）。到点把对应 `ScheduledTask` 触发为后台 Job。`ScheduledTask`（id/ownerId/cron/jobSpec/enabled/lastRunAt/nextRunAt，持久化）。`ScheduledTaskRepository`（内存 + Postgres）。
- **DoD**：注入时钟推进 → 到点触发 Job（单测）；`ScheduledTask` 持久化、可启停、按 owner；重启后调度恢复（从 Postgres 装载）。
- **依赖**：S5-T1。

### S5-T4 · 定时模板（存为定时任务）
- **做**：把一次 skill/agent/研究运行 + 输入存成 `ScheduledTask`（如「每天 8:00 跑 daily-briefing skill」「每周一跑竞品监控 agent」）。API：create/list/toggle/delete schedule + run-now。
- **DoD**：把一个 skill 存成每日定时任务 → 列表可见 → run-now 立即产出一个 Job → 到点也会自动产出；可启停/删除。
- **依赖**：S5-T3。

---

## 里程碑 C — 通知与信息流

### S5-T5 · 通知
- **做**：`NotificationRepository`（内存 + Postgres）。Job 完成/失败 → 写通知（站内）+ 可插拔投递（webhook/email **stub**，离线默认）。未读/已读、按 owner。
- **DoD**：后台 Job 完成 → 产生一条站内通知；可列未读、标记已读；webhook stub 被调用（可断言）；按 owner 隔离。
- **依赖**：S5-T1。

### S5-T6 · 收件箱 / 历史 UI
- **做**：Demo 升级：定时任务管理（列表/启停/run-now/删除）、Job 运行历史（状态+产物链接+重连查看）、通知 feed（未读角标/标记已读）。
- **DoD**：浏览器里把研究存为每日定时任务 → run-now → 历史出现 Job → 完成后 feed 有通知 → 点开看产物。Sprint Demo 即此流程。
- **依赖**：S5-T2、S5-T4、S5-T5。

---

## 里程碑 D — 后台执行安全

### S5-T7 · 后台/定时执行的分级安全
- **做**：后台/定时 Agent 运行**无人确认**：默认 `approve=deny`（只读）；或 `ScheduledTask`/Job spec 声明**预授权工具白名单**（仅允许其中的 low_write 工具，等价于预先确认），**high_write 永拒**。预授权与每次后台写入落审计。配额计入后台 Job。
- **DoD**：单测：无白名单的后台 agent 的 low_write 工具不执行（denied）；白名单内的 low_write 执行并审计「pre-authorized」；high_write 即使在白名单也拒。配额超限的后台 Job 被拒。
- **改动**：`harness-core/src/jobs/*`（approve 策略）、`agent` 接入、`audit`。
- **依赖**：S5-T1、Sprint 04 Agent/审计。

---

## 里程碑 E — 质量闸门

### S5-T8 · Eval 扩展（自治）
- **做**：扩 `evals/`：①调度触发（注入时钟到点 → Job 产生）②后台 Job 完成 + run-log 重放完整 ③通知投递（完成 → 通知 + webhook stub 调用）④只读后台调度不执行写入 / 预授权白名单按上限放行、high_write 拒 ⑤审计含预授权记录。CI 用 stub（确定性、离线）。
- **DoD**：`pnpm eval` 覆盖以上；CI 必过；故意破坏（到点不触发 / 重放缺事件 / 通知漏发 / 后台越权写入）任一即变红。
- **依赖**：S5-T1…T7。

### S5-T9 · 文档回写 + Demo 升级
- **做**：更新 README/ARCHITECTURE/CLAUDE/AGENTS（Job/调度/通知命令与 env、后台执行安全模型）。Demo 端到端走通（离线可演示），Sprint 05 DoD 勾选。
- **DoD**：新人/新代理按 README 一条命令起本地；命令与实际一致；Demo 端到端可演示。
- **依赖**：S5-T1…T8。

---

## 执行顺序与并行建议

```
S5-T1(Job 运行时) ──┬─ S5-T2(Job API + 重放)
                    ├─ S5-T3(调度器) ─ S5-T4(定时模板)
                    ├─ S5-T5(通知)
                    └─ S5-T7(后台执行安全)
                                 全部收口 → S5-T6(收件箱 UI) → S5-T8(Eval) → S5-T9(Docs/Demo)
```
- **关键路径**：S5-T1（Job 运行时）解锁 API/调度/通知/安全；S5-T6（UI）汇聚展示。
- **可并行**：T1 后 API（T2）、调度（T3）、通知（T5）、安全（T7）并行。
- **每完成一个任务**：跑该模块单测 + 相关 eval；一任务一 PR，CI 绿即合；提交说明写清「动了哪个注册点 + 加了哪个 eval」。

## Sprint 05 Definition of Done（整体验收）— ✅ 全部达成
- [x] 后台 Job：任意 orchestrator 可作为后台 Job 运行，断连不影响完成；状态/run-log 持久化、按 owner。
- [x] 重连重放：`:id/events` 断连后重连可看到完整事件直到终态。
- [x] 调度：cron 定时到点触发 Job；ScheduledTask 持久化、可启停、重启恢复（从 Postgres 装载）。
- [x] 定时模板：skill/agent/研究可存为定时任务，run-now + 自动触发都产出 Job。
- [x] 通知：Job 完成/失败 → 站内通知 + webhook stub；未读/已读；按 owner。
- [x] 后台安全：无人确认默认只读；预授权白名单仅放行其内 low_write；high_write 永拒。
- [x] 配额：后台 Job（含调度触发）计入配额，超限被拒（JobRunner.canRun）。
- [x] `pnpm eval` 含调度触发/后台完成重放/通知投递/后台安全（19 项总检）；CI 全门禁绿。
- [x] 持久化：定时任务/Job/通知重启后仍在（Postgres）。
- [x] README/命令/架构文档一致更新；Demo 端到端走通（离线可演示）。

> Sprint 05 完成。S5-T1–T9 全部合并到 `main`（PR #34–#38），CI 全门禁绿（含 Postgres service）。

## 风险与提示（给代理）
- **后台无人确认是安全红线**：定时/后台 Agent 绝不自我确认低风险写入——只读，或仅按预授权白名单放行（上限 low_write），high_write 永拒。预授权是显式人类配置，落审计。
- **调度用进程内 + 注入时钟**：不引外部 cron/queue；时钟可注入保证 eval 确定性、离线可跑。生产换 durable queue 时接口不变（升级即换挡）。
- **run-log 是重放的根**：后台 Job 的每个事件持久化，重连从存储重放再续实时；别让结果只活在内存里。
- **通知可插拔**：站内 feed 必做；webhook/email 用 stub（离线可断言），真实投递 provider 留位。
- **配额别漏后台**：后台/定时 Job 同样计入 owner 配额，否则定时任务会绕过成本闸。
- **不要扩范围**：Cowork 整合、文本产品面、浏览器执行、生产前端一律 Sprint 06+；本 Sprint 只把「定时 + 后台自治 + 通知 + 后台安全」打穿。
- **不确定/不可逆**（cron 语义子集、调度 tick 粒度、通知投递格式）→ 选保守默认并在 PR 标注；任何真实外部投递先确认。
