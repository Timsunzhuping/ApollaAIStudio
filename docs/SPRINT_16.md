# Sprint 16 执行单 — Scale & Reliability：分布式持久任务队列 + Worker

> 读者：**Codex / Claude Code**。逐任务从上往下执行；每个任务自带验收（DoD）、依赖、改动位置。
> 前置必读：[ARCHITECTURE.md](./ARCHITECTURE.md)（公理③升级即换挡 / 适配器矩阵）· [AGENTS.md](../AGENTS.md)（执行/安全铁律）· `packages/harness-core/src/jobs/`（`JobRunner` start→runInBackground、`JobRepository` 的 `appendEvent`/`events`/`listNonTerminal`、`JobResolver`）· `packages/harness-core/src/schedule/scheduler.ts` + `apps/bff/src/server.ts` 的进程内 cron tick（`setInterval` 30s）· `apps/bff/src/server.ts` 的 `/api/jobs/:id/events`（**已经在轮询 `jobRepo.events()` 尾随持久化 run-log，而非 await 进程内 done**——天然与生产者解耦）· Sprint 05（jobs/scheduler）· Sprint 10（`reconcileJobs` 残留对账）· Sprint 15（发布就绪 / DEPLOY.md）。
> 目标产物（Sprint Demo）：**配 `REDIS_URL` 后，Web BFF 只"入队"任务、独立 **Worker 进程** 消费并执行；任务在 Web 重启/部署后存活、Worker 可水平扩展；SSE 仍从持久 run-log 尾随、跨进程实时出流；失败重试+退避、优雅停机排空在途；不配 `REDIS_URL` 则退化为进程内执行（当前行为，离线确定性，全部既有测试/e2e 不变）。**

## 0. Sprint 范围与非目标

**主题**：十五个 Sprint 把产品做成了可上线、可测、可部署的完整工作台——但**后台任务仍跑在 Web 进程里**（`JobRunner` 在请求外 detached 执行 + 进程内 `setInterval` cron）。对一个跑长任务（研究/媒体生成/Cowork/定时）的 To-C 产品，这是真实的生产瓶颈：任务**阻塞 Web 进程、部署时易丢、无法水平扩展**。本 Sprint 用 harness 的招牌动作——**可换挡 capability provider**——把"任务执行基座"也做成可插拔：`JobQueue` 适配器（**进程内默认 / Redis(BullMQ) 生产**），独立 **Worker 进程** 消费队列执行，Web 只入队。地基已就位：run-log 持久化 + SSE 已尾随该 log（生产者/流式天然解耦），`reconcileJobs` 已能对账残留——本 Sprint 把执行从 Web 进程**搬出去**并补齐分布式可靠性。

**做（本 Sprint 的闭环）**
- `JobQueue` 抽象 + 拆分 `JobRunner`：把"创建+配额+入队"与"运行 handler（set running→resolve→appendEvent→终态→onComplete）"拆开；`InProcessJobQueue`（默认，保持当前 detached-in-process 行为，离线确定性）；`jobs.start` → 建 job(queued) + 配额门 + `queue.enqueue(jobId)`。
- 独立 **Worker 进程**（`workers/job-worker`）：装配 harness 依赖（resolver/repos/安全）+ 一个 `JobQueue` + 消费（调 `JobRunner.run`）+ 跑 **Scheduler tick**（分布式下调度只在 Worker 一处，杜绝多实例重复 tick）；优雅停机。
- `RedisJobQueue`（**BullMQ over `REDIS_URL`**，env 门控）：enqueue 按 jobId 入队、Worker `process` 消费；并发/重试/退避配置；**缺 `REDIS_URL` 回退进程内**。
- 分布式正确性：配 Redis 时 Web 只入队（不执行）、Worker 执行；SSE 跨进程尾随持久 log（已支持）；Worker 启动 `reconcileJobs` 后**重新入队**被打断的 job；**幂等消费**（重投不二次执行/扣费/污染 log——按 job 状态门控，仅非终态才跑）。
- 可靠性 + 运维：重试+退避+最大次数→终态 `failed`（落审计）、job 超时、Worker 优雅停机**排空在途**；配额/安全在 Worker 路径同样强制（子代理继承、high_write 规则不破）；`infra/docker-compose.yml` 加 Redis service + Worker 运行；Worker 健康/指标；`DEPLOY.md` 更新（Web+Worker+Redis 拓扑、`REDIS_URL`、扩 Worker）。
- 质量闸门：进程内队列行为（不变）、入队→消费→log 解耦、重试→failed、reconcile 重入队、幂等消费、不重复 tick；Redis 适配器**集成测试**（CI Redis service 门控，离线缺 Redis 时 skip）；文档。

**不做（留待 Sprint 17+）**
- 低延迟 SSE 的 Redis pub/sub（本 Sprint 沿用 PG 轮询尾随 log，已够用）；用 BullMQ repeatable jobs 取代现有 cron（仅把现有 Scheduler 搬进 Worker）。
- 其它 broker（SQS/Kafka/RabbitMQ）——只做**一个** Redis 适配器在接口后；优先级队列/公平调度深度；exactly-once（只做幂等消费）。
- 多区域 / 自动扩缩容策略 / leader 选举（调度单 Worker 即可）；把研究/Agent 的**流式 token**搬到队列（仍是 SSE 直连那条；队列管的是 Job 这层）。

**全程铁律**（违反即返工，见 [AGENTS.md](../AGENTS.md)）：`JobQueue` 是可换挡适配器（**进程内默认 / Redis env 门控**，缺 `REDIS_URL` 回退进程内）；**默认/离线路径行为不变**——root 测试 + e2e 保持 hermetic（不需 Redis），CI 仅为一个**门控**集成测试起 Redis service；**持久优先**（job 先落库再入队；`reconcileJobs` 重入队残留；**幂等消费**——重投/重启不得二次执行、二次扣配额、或向 log 追加重复/损坏事件，按 job 状态门控）；**两条路径都保全既有 Job 语义**（配额门、审计、安全：子代理继承全部安全、high_write 永拒、后台无人确认白名单、配额计入后台；onComplete 通知；SSE 尾随 log 的 reconnect/replay）；**调度只在一处**（分布式下 Worker），杜绝多实例重复 tick；`REDIS_URL`/密钥从 env、不入日志；Worker 最小权限；**优雅停机排空在途**；改动集中在 `harness-core`(jobs)、`adapters`(queue)、`workers/`、`apps/bff`(入队)、`infra`、`docs`；每个能力配测试。

---

## 里程碑 A — JobQueue 抽象 + Worker 骨架

### S16-T1 · JobQueue 接口 + JobRunner 拆分 + InProcessJobQueue（默认）
- **做**：`harness-core/src/jobs`：`JobQueue` 接口（`enqueue(jobId)` + `process(handler)`）。把 `JobRunner.runInBackground` 提为公开 `run(job, spec)`（运行 handler：set running→resolve→appendEvent→终态→onComplete）；`start()` 改为建 job(queued)+配额门+`queue.enqueue(jobId)`。`InProcessJobQueue`：enqueue → detached 立即 `run`（**等价当前行为**）。Worker handler 从 jobId 载 job（取 kind/input=spec）再 `run`。
- **DoD**：默认模式下所有既有 job 行为不变（研究/媒体/cowork/定时/SSE/reconcile/配额/审计）；`pnpm test` + `pnpm e2e` 全绿；新增单测覆盖 enqueue→consume→log。
- **改动**：`harness-core/src/jobs/*`、`apps/bff/src/harness.ts`（装配 InProcessJobQueue）。
- **依赖**：S05 jobs。

### S16-T2 · 独立 Worker 进程骨架
- **做**：新 `workers/job-worker`（@apolla/job-worker）：装配 harness 依赖（resolver/repos/安全/配额）+ 一个 `JobQueue` + `queue.process(run)` 消费 + 跑 Scheduler tick；优雅停机（SIGTERM 排空）。默认（进程内）模式 Worker 可选（Web 自执行）；分布式模式 Web 不执行、Worker 执行。
- **DoD**：`pnpm --filter @apolla/job-worker start` 起得来、连库、消费、停机干净；两种拓扑文档化。
- **改动**：`workers/job-worker/*`、`pnpm-workspace.yaml`（已含 `workers/*`）。
- **依赖**：S16-T1。

---

## 里程碑 B — Redis 队列适配器 + 分布式执行

### S16-T3 · RedisJobQueue（BullMQ，env 门控）
- **做**：`adapters/queue/redis`（@apolla/queue-redis）：`RedisJobQueue`（**BullMQ over `REDIS_URL`**）enqueue 按 jobId 入队、`process` 起 BullMQ Worker 消费；并发、重试次数+退避配置。`buildJobQueue()`：有 `REDIS_URL` → Redis，否则 InProcess。
- **DoD**：配 `REDIS_URL`（本地/CI Redis）时入队+消费走通；缺 `REDIS_URL` 回退进程内；适配器单测（连真 Redis 的集成测试见 T7）。
- **依赖**：S16-T1/T2。

### S16-T4 · 分布式执行正确性
- **做**：配 Redis 时 **Web 只入队不执行**、Worker 执行；SSE 跨进程尾随持久 log（已支持，验证）；Worker 启动 `reconcileJobs` → **重新入队**被打断 job；**幂等消费**（消费时按 job 状态门控：仅非终态才 run，重投直接 ack）；**调度只在 Worker**（Web 在分布式模式不起 cron）。
- **DoD**：Web 进程不执行 job（仅入队）；杀掉 Worker 中途的 job 重启后被重入队并完成；同一 job 重投不二次执行/扣费；多 Web 实例不重复 tick。
- **依赖**：S16-T3、S10 reconcile。

---

## 里程碑 C — 可靠性 + 运维

### S16-T5 · 重试/退避/超时/排空 + 安全保全
- **做**：失败重试+指数退避+最大次数 → 终态 `failed`（落审计 + onComplete 通知）；job 超时；Worker 优雅停机**排空在途**（停拉新活、等在途完成或超时）；**配额/安全在 Worker 路径同样强制**（`canRun` 配额门、子代理继承安全、high_write 永拒、后台无人确认白名单）。
- **DoD**：注入失败 → 重试到上限 → failed + 审计 + 通知；超时 job 终止为 failed；停机时在途 job 不被腰斩成脏态；Worker 路径配额/安全等同 Web 路径。
- **依赖**：S16-T3/T4。

### S16-T6 · 运维与基础设施
- **做**：`infra/docker-compose.yml` 加 **Redis** service；Worker 运行方式（compose/Dockerfile 或文档化 `start`）；Worker 健康/指标（复用 metrics 风格）；`DEPLOY.md` 更新（Web + Worker + Redis 三件套拓扑、`REDIS_URL`、按需扩 Worker、调度归属 Worker、env 矩阵补充）。
- **DoD**：`docker compose up` 起 Redis；按 DEPLOY 起 Web+Worker+Redis 跑通一个分布式任务；env 文档准确。
- **依赖**：S16-T3、S15 DEPLOY.md。

---

## 里程碑 D — 质量闸门

### S16-T7 · Eval/测试扩展
- **做**：进程内队列行为（不变回归）；入队→消费→log 解耦；重试→failed；reconcile 重入队；**幂等消费**（重投不二次执行）；不重复 tick；Worker 路径配额/安全。`RedisJobQueue` **集成测试**：CI 加 Redis service，测试**门控**于 `REDIS_URL`（离线缺 Redis 时 `skip`，诚实标注）。root 套件保持 hermetic（不依赖 Redis）。可加 1 项 eval（队列入队→消费→终态）。
- **DoD**：`pnpm test` + `pnpm e2e` 全绿且 hermetic；CI 上 Redis 集成测试通过；故意破坏（非幂等/不重试/调度重复/安全在 Worker 失效）任一即变红。
- **依赖**：S16-T1…T6。

### S16-T8 · 文档回写
- **做**：README（队列/Worker 拓扑、`REDIS_URL`、进程内默认、如何起 Worker）；ARCHITECTURE（§ 适配器矩阵加 `JobQueue`；生产者(Worker)→持久 log→SSE 尾随 数据流；进程内 vs 分布式两拓扑图）；CLAUDE/AGENTS（队列铁律）；Sprint 16 DoD 勾选。
- **DoD**：新人照 README 起进程内（默认）与分布式（Redis+Worker）两种模式；文档准确。
- **依赖**：S16-T1…T7。

---

## 执行顺序与并行建议

```
S16-T1(JobQueue 抽象+InProcess+JobRunner 拆分) ─ S16-T2(Worker 骨架) ─ S16-T3(RedisJobQueue) ─┬─ S16-T4(分布式正确性)
                                                                                              ├─ S16-T5(重试/排空/安全)
                                                                                              └─ S16-T6(运维/infra)
                                                                                  全部收口 → S16-T7(测试) → S16-T8(Docs)
```
- **关键路径**：S16-T1（抽象 + InProcess 保持现状）→ S16-T2（Worker）→ S16-T3（Redis）是地基；正确性/可靠性/运维在其上并行。
- **每完成一个任务**：跑该模块测试 + 既有 job 回归 + `pnpm e2e`；一任务一 PR，CI 绿即合。
- **建议 PR 分组**：A(T1+T2) · B(T3+T4) · C(T5+T6) · D(T7+T8)。

## Sprint 16 Definition of Done（整体验收）
- [x] `JobQueue` 抽象 + `JobRunner` 拆分；`InProcessJobQueue` 默认保持当前行为，既有 job/SSE/reconcile/配额/审计不变。
- [x] 独立 Worker 进程（`workers/job-worker`）消费队列 + 跑调度 + 优雅停机。
- [x] `RedisJobQueue`（BullMQ，`REDIS_URL` 门控，缺则回退进程内）。
- [x] 分布式：Web 只入队、Worker 执行、SSE 跨进程尾随；reconcile 重入队；幂等消费；调度单点。
- [x] 可靠性：重试+退避+上限→failed（通知）、超时、停机排空；Worker 路径配额/安全保全。
- [x] 运维：compose 加 Redis、Worker 运行 + /health、DEPLOY.md 拓扑+env。
- [x] `pnpm test` + `pnpm e2e` 全绿且 hermetic；CI Redis 集成测试通过（门控 skip 离线）。
- [x] README/架构文档更新。

> **Sprint 16 完成**（PR [#91](https://github.com/Timsunzhuping/ApollaAIStudio/pull/91) A · [#92](https://github.com/Timsunzhuping/ApollaAIStudio/pull/92) B · [#93](https://github.com/Timsunzhuping/ApollaAIStudio/pull/93) C · D 本次）。可换挡 **JobQueue**（`InProcessJobQueue` 默认 / `RedisJobQueue`(BullMQ) env 门控）+ `JobRunner` 拆 `start`(入队)/`run`(幂等消费) + Job 持久 `allowTools`；独立 **Worker**（`workers/job-worker`）消费 + 单点调度 + reconcile 重入队 + `/health` + 优雅排空；可靠性：重试+指数退避+上限→failed（重试前 `clearEvents`）、`JOB_TIMEOUT_MS` 超时、Worker 路径配额/安全保全；运维：compose 加 Redis、`DEPLOY.md` 进程内 vs 分布式拓扑 + env。SSE 仍尾随持久 run-log（生产者解耦，零改动）。默认路径零回归（275 root + 8 skip + eval 38 + 9 e2e，全程 hermetic）；Redis 集成测试本地 + CI（Redis service）通过。完整 exactly-once/Redis pub/sub SSL/其它 broker 列为后续。

## 风险与提示（给代理）
- **默认路径零回归是底线**：`InProcessJobQueue` 必须与今天行为逐字等价；root 测试 + e2e 不许依赖 Redis，全程 hermetic。Redis 仅 CI service + 一个门控集成测试。
- **复用既有解耦**：SSE 已轮询尾随持久 `jobRepo.events()`——生产者搬到 Worker 后**无需改 SSE**；验证即可，别重写。
- **幂等是分布式命脉**：消费时按 job 状态门控（仅非终态才 run）；重投/重启/reconcile 重入队都不得二次执行、二次扣配额、或重复 append 事件。
- **持久后入队**：先 `repo.create(job)` 再 `enqueue(jobId)`；Worker 从库载 spec；崩溃后 `reconcileJobs` 把残留重入队。
- **调度单点**：分布式下 cron tick 只在 Worker 跑；Web 不起 `setInterval`，否则多 Web 实例重复触发定时任务。
- **安全不打折**：Worker 路径同样过配额门 + Safety 三级 + 子代理继承 + high_write 永拒 + 后台白名单 + 审计；别让"搬出 Web"绕过任何一层。
- **优雅停机**：SIGTERM 停拉新活、排空在途（或超时后标记可重入队），不要把在途 job 腰斩成脏态。
- **诚实边界**：真实 BullMQ 端到端是 CI-service/部署事项；本 Sprint 测进程内全语义 + Redis 适配器集成测试（门控），PR 写明。
- **不确定/不可逆**（队列 key 命名/重试次数/退避曲线/超时阈值/停机排空时限/调度归属）→ 选保守默认并在 PR 标注。
