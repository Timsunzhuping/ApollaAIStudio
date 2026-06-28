# Sprint 17 执行单 — Observability & Operability：分布式链路追踪（OpenTelemetry）

> 读者：**Codex / Claude Code**。逐任务从上往下执行；每个任务自带验收（DoD）、依赖、改动位置。
> 前置必读：[ARCHITECTURE.md](./ARCHITECTURE.md)（公理③升级即换挡 / §3.11 可观测性）· [AGENTS.md](../AGENTS.md)（安全/脱敏铁律）· `packages/harness-core/src/obs/tracer.ts`（已有 `Tracer`/`Span` 极简抽象 + `NoopTracer`/`ConsoleTracer`，**但 harness 从不注入**——`research.ts` 用的是默认 NoopTracer，等于没接）· `apps/bff/src/obs.ts`（S10 的 Metrics + request-id + 脱敏日志 `observe()`）· Sprint 10（可观测性地基）· Sprint 15（发布就绪 / health）· Sprint 16（分布式：Web + Worker + Redis + PG）。
> 目标产物（Sprint Demo）：**一次请求在 Web 入队、在 Worker 执行——现在是**一条端到端 trace**（HTTP span → enqueue → 跨进程 → worker job span → 编排/工具/LLM 子 span），traceparent 经 Job 从 Web 透传到 Worker；request-id ↔ trace-id 关联，日志带 trace/span id；配 `OTEL_EXPORTER_OTLP_ENDPOINT` 导出到 collector，不配则 Noop（零开销、离线确定性）；span 绝不含密钥/PII。**

## 0. Sprint 范围与非目标

**主题**：S16 把产品变成了**分布式多进程系统**（Web + Worker(s) + Redis + PG）——但它现在是**不透明的**：一个在 Web 入队、在 Worker 执行的任务，**无法端到端追踪**；`Tracer` 抽象早就存在却从没接进 harness（research 用的是 NoopTracer，其余编排/工具/Job/HTTP 完全没 span）。本 Sprint 用 harness 的招牌动作——**可换挡 capability provider**——把"可观测性"做成真适配器：`Tracer`（**Noop 默认 / OpenTelemetry 生产**，env 门控），把 span 接进编排器/工具/路由/Job/HTTP，并**跨进程透传 trace 上下文**（Web→队列→Worker 一条 trace）。这是 S10（metrics/request-id/脱敏日志）→ S15（发布就绪）→ S16（规模）之后**运维可观测性的收口**：让这套分布式系统真正可调试、可度量。

**做（本 Sprint 的闭环）**
- `Tracer` 抽象升级 + 适配器：扩展 `Tracer`/`Span`（**子 span（父上下文）**、status、events、属性、`traceparent` 注入/提取）**向后兼容**；`InMemoryTracer`（记录 span 树，确定性可测）+ `NoopTracer`（默认）；`@apolla/otel` 的 `OtelTracer`（OTel SDK + OTLP/HTTP 导出，env 门控 `OTEL_EXPORTER_OTLP_ENDPOINT`/`OTEL_SERVICE_NAME`/采样率；缺 endpoint → Noop）。
- 接进 harness：`buildTracer()` 注入 harness，贯穿研究/Agent/Cowork（**子代理 fan-out 作子 span**）/媒体/Surface 编排、LLM Router 调用（模型别名/tokens/成本作属性，**脱敏**）、工具运行时（每次工具调用一个子 span）。
- HTTP + Job span + **跨进程透传**：入站 HTTP 请求 span（method/route/status/owner 哈希，脱敏）；Job 运行 span；**入队时把 traceparent 写入 Job → Worker 提取**，使 Web→队列→Worker 成为**一条 trace**；request-id ↔ trace-id 关联；日志带 trace/span id。
- 运维面：每操作的时延 + 成功/失败计数（research/job/tool/llm）经 `/metrics`（增强）暴露；轻量 SLO/错误预算视图；采样配置；**关停 flush**（Web + Worker 退出前刷盘 span）；health 增强。
- 安全：span **绝不含密钥/PII**（属性过脱敏、owner id 哈希）；**入站 traceparent 不可信**（只用于关联，绝不参与鉴权/安全判定）；追踪**不改变行为、不拖慢热路径**（采样 + 异步导出 + 绝不阻塞）。
- 质量闸门：`InMemoryTracer` span 树断言（研究产出预期 span 层级、工具调用是子 span、子代理嵌套）；跨进程透传（入队注入→Worker 续上同一 trace-id）；脱敏（span 属性无密钥/PII）；eval；全程 hermetic（Noop/InMemory，绝不连真 collector）。

**不做（留待 Sprint 18+）**
- OTel 自动埋点（http/pg/redis 的 contrib auto-instrumentation）——本 Sprint 只做**显式** span（可控、可测）。
- 浏览器端 RUM/前端追踪；日志聚合后端（Loki/ELK）；APM 厂商特定集成；持续性能剖析（profiling）。
- 告警规则 / 仪表盘即代码 / Prometheus 抓取栈（仅 `/metrics` 暴露，接入是部署事项）；指标专用 backend。
- Redis pub/sub 低延迟 SSE（仍 S16 的 PG 轮询）。

**全程铁律**（违反即返工，见 [AGENTS.md](../AGENTS.md)）：`Tracer` 可换挡（**Noop 默认/离线，OTel env 门控**，缺 `OTEL_EXPORTER_OTLP_ENDPOINT` 回退 Noop）；**默认/离线 hermetic**——root 测试 + e2e 用 Noop/InMemory，**绝不连真实 collector/网络**；**span 绝不含密钥/PII**（属性过脱敏、owner 哈希，沿用 S10 日志脱敏纪律）；**入站 traceparent 不可信**（仅关联，绝不用于鉴权/owner 判定）；追踪**不改变功能语义、不阻塞热路径**（采样、异步导出、失败静默降级）；**跨进程透传走 Job**（traceparent 持久在 Job 上，不另开侧信道）；关停前 flush（Web + Worker）；保留既有 Metrics/request-id/脱敏日志，**追踪是附加**；改动集中在 `harness-core`(obs)、`adapters`(otel)、`apps/bff`、`workers`、`contracts`(Job.traceparent)、`docs`；每个能力配测试。

---

## 里程碑 A — Tracer 抽象升级 + OTel 适配器

### S17-T1 · 扩展 Tracer/Span + InMemoryTracer
- **做**：扩展 `Tracer`/`Span`（**向后兼容**）：`startSpan(name, { attributes?, parent? }) → Span`；`Span` 加 `setAttributes`/`addEvent`/`setStatus('ok'|'error')`/`end()`/`spanContext()`（含 traceId/spanId）；`Tracer` 加 `extract(traceparent)→ParentContext` 与 `inject(span)→traceparent`、`shutdown()`。`InMemoryTracer`（记录 span 树 + 父子链，供测试断言）。span 属性**脱敏**辅助（去密钥/PII、owner 哈希）。
- **DoD**：用 InMemoryTracer 可断言父子 span 层级、属性、status；`inject`/`extract` 往返一致；脱敏过滤掉敏感键。既有 `startSpan(name, attrs)`/`end(attrs)` 调用点不破。
- **改动**：`harness-core/src/obs/tracer.ts`、`harness-core/src/obs/redact.ts`（或复用现有脱敏）。
- **依赖**：S10 脱敏。

### S17-T2 · OtelTracer 适配器（env 门控）
- **做**：`adapters/otel`（@apolla/otel）：`OtelTracer`（OpenTelemetry Node SDK + OTLP/HTTP trace 导出；`OTEL_EXPORTER_OTLP_ENDPOINT`/`OTEL_SERVICE_NAME`/采样率从 env）。`buildTracer()`：有 endpoint → Otel，否则 Noop。`shutdown()` flush。
- **DoD**：缺 endpoint → Noop（零开销）；配 endpoint → 构造成功、span 经 OTLP 导出（导出本身是部署事项，单测覆盖映射/采样/shutdown 逻辑，真 collector 见 T7 说明）。
- **依赖**：S17-T1。

---

## 里程碑 B — 接入 harness + 跨进程透传

### S17-T3 · 编排器 / Router / 工具埋点
- **做**：`buildTracer()` 注入 harness，贯穿研究/Agent/Cowork/媒体/Surface 编排：每次 run 一个根/子 span；**Cowork 子代理 fan-out 作子 span**；LLM Router 每次调用一个子 span（模型别名、tokens、成本作属性，**脱敏**）；工具运行时每次工具调用一个子 span（工具名、risk、decision，输入**不入 span**）。
- **DoD**：InMemoryTracer 下，研究 run 产出预期 span 树（plan/search/generate + 各 LLM/工具子 span）；cowork 的子代理是父 run 的子 span；span 属性脱敏。
- **改动**：`harness-core`(orchestrator/agent/cowork/router/tools)、`apps/bff/src/harness.ts`。
- **依赖**：S17-T1/T2。

### S17-T4 · HTTP + Job span + 跨进程透传
- **做**：入站 HTTP 请求 span（method/route/status/owner 哈希，脱敏；与 `observe()`/request-id 关联，**request-id ↔ trace-id**）；Job 运行 span；**入队时 `inject` 当前 span 的 traceparent 写入 `Job.traceparent`（新契约字段）→ Worker `extract` 作 job span 父**，Web→队列→Worker 一条 trace；日志行带 trace/span id。
- **DoD**：HTTP 请求产生 span 且响应头有 request-id；分布式下，Web 入队的 job 在 Worker 执行时 **trace-id 与发起请求一致**（同一条 trace）；日志含 trace/span id。
- **改动**：`apps/bff/src/server.ts`(+obs.ts)、`workers/job-worker`、`contracts`(Job.traceparent)、`harness-core`(jobs)。
- **依赖**：S17-T3、S16 队列/Worker。

---

## 里程碑 C — 运维面与安全

### S17-T5 · 指标 / SLO 增强
- **做**：每操作（research/job/tool/llm）时延 + 成功/失败计数（复用/扩展 `Metrics`），经 `/metrics` 暴露；轻量 SLO/错误预算摘要（成功率、p50/p95 时延）；可选 OTel metrics。
- **DoD**：`/metrics` 含每操作计数/时延；SLO 摘要数值正确；无密钥/PII。
- **依赖**：S17-T3/T4、S10 Metrics。

### S17-T6 · 可操作性与安全
- **做**：采样配置（dev 全采 / prod 按比例）；**关停 flush**（Web + Worker SIGTERM 前 `tracer.shutdown()` 刷盘）；**入站 traceparent 不可信**（只关联、不参与安全判定）；span 脱敏（属性白名单 + owner 哈希，绝不含密钥/PII/原始用户内容）；health 增强（trace 导出状态）；`DEPLOY.md`（`OTEL_*` env、collector 拓扑、采样）。
- **DoD**：SIGTERM 时 pending span 被 flush；伪造 traceparent 不影响鉴权/owner 隔离；span 属性审查无敏感数据；DEPLOY 文档准确。
- **依赖**：S17-T2、S17-T4、S10/S16 安全。

---

## 里程碑 D — 质量闸门

### S17-T7 · Eval/测试扩展
- **做**：`InMemoryTracer` span 树断言（研究层级、工具/LLM 子 span、cowork 子代理嵌套）；**跨进程透传**（入队 `inject` → Worker `extract` → 同 trace-id；用 InMemoryTracer + 内存队列模拟两端）；脱敏（span 属性无密钥/PII，伪造 traceparent 不越权）；OtelTracer 映射/采样/shutdown 单测（不连真 collector）。可加 1 项 eval（trace 树/透传）。root 套件 + e2e 全程 hermetic（Noop/InMemory）。
- **DoD**：`pnpm test` + `pnpm e2e` 全绿且 hermetic；故意破坏（不透传/不脱敏/采样错/不 flush）任一即变红。
- **依赖**：S17-T1…T6。

### S17-T8 · 文档回写
- **做**：README（追踪：`OTEL_*` env、Noop 默认 / OTel、本地起 collector、覆盖什么）；ARCHITECTURE（§ 适配器矩阵加 `Tracer`；端到端 trace 数据流：HTTP→enqueue→worker→编排/工具/LLM；与 metrics/日志的关系）；CLAUDE/AGENTS（追踪铁律）；Sprint 17 DoD 勾选。
- **DoD**：新人照 README 在 Noop 默认与 OTel（本地 collector）两种模式跑通；文档准确。
- **依赖**：S17-T1…T7。

---

## 执行顺序与并行建议

```
S17-T1(Tracer 升级+InMemory) ─ S17-T2(OtelTracer) ─ S17-T3(编排/Router/工具埋点) ─┬─ S17-T4(HTTP/Job/跨进程透传)
                                                                                  ├─ S17-T5(指标/SLO)
                                                                                  └─ S17-T6(可操作性/安全)
                                                                      全部收口 → S17-T7(测试) → S17-T8(Docs)
```
- **关键路径**：S17-T1（抽象升级 + InMemory）→ S17-T2（OTel）→ S17-T3（埋点）是地基；HTTP/透传、指标、安全在其上并行。
- **每完成一个任务**：跑该模块测试 + 既有回归 + `pnpm e2e`；一任务一 PR，CI 绿即合。
- **建议 PR 分组**：A(T1+T2) · B(T3+T4) · C(T5+T6) · D(T7+T8)。

## Sprint 17 Definition of Done（整体验收）
- [ ] `Tracer`/`Span` 升级（子 span/status/events/inject·extract/shutdown，向后兼容）+ `InMemoryTracer` + 脱敏。
- [ ] `OtelTracer`（OTLP，env 门控，缺 endpoint → Noop）。
- [ ] 埋点：研究/Agent/Cowork（子代理子 span）/媒体/Surface + Router + 工具，属性脱敏。
- [ ] HTTP + Job span + **跨进程透传**（traceparent 经 Job：Web→Worker 一条 trace）；request-id ↔ trace-id。
- [ ] 指标/SLO 增强经 `/metrics`；采样；关停 flush（Web + Worker）。
- [ ] 安全：span 无密钥/PII；入站 traceparent 不可信；追踪不改行为/不阻塞。
- [ ] `pnpm test` + `pnpm e2e` 全绿且 hermetic（Noop/InMemory，不连 collector）。
- [ ] README/架构文档更新。

## 风险与提示（给代理）
- **默认零开销 + hermetic**：无 `OTEL_*` → NoopTracer，热路径零成本；root 测试 + e2e 全程 Noop/InMemory，**绝不连真实 collector/网络**。
- **脱敏是底线**：span 属性走白名单 + owner 哈希；**绝不**把密钥/token/原始用户内容/PII 写进 span（沿用 S10 日志脱敏）。
- **traceparent 不可信**：入站 header 的 traceparent 只用于 trace 关联；**绝不**据此做鉴权/owner 判定/信任提升。
- **跨进程靠 Job**：入队 `inject` 把 traceparent 持久到 `Job.traceparent`，Worker `extract` 续上——别另造侧信道；这正是 S16 分布式追踪的关键一环。
- **不阻塞热路径**：采样 + 异步批量导出；导出失败静默降级，绝不让追踪拖慢或拖垮请求/Job。
- **关停 flush**：Web 与 Worker 的 SIGTERM 都要 `tracer.shutdown()` 刷盘，否则丢最后一批 span。
- **向后兼容**：扩展 `Tracer`/`Span` 时保留既有 `startSpan(name, attrs)`/`end(attrs)`（research.ts 已在用），避免大面积改写。
- **诚实边界**：真 collector 端到端是部署事项；本 Sprint 测 InMemory span 树 + 透传 + OtelTracer 映射/采样/shutdown 逻辑，PR 写明。
- **不确定/不可逆**（span 命名规范、属性白名单、采样默认、traceparent 存 Job 字段 vs input、metrics 桶边界）→ 选保守默认并在 PR 标注。
