# Sprint 21 执行单 — Realtime：协同编辑（CRDT + 实时同步）

> 读者：**Codex / Claude Code**。逐任务从上往下执行；每个任务自带验收（DoD）、依赖、改动位置。
> 前置必读：[ARCHITECTURE.md](./ARCHITECTURE.md)（§实时/SSE）· [AGENTS.md](../AGENTS.md)（owner 隔离 + untrusted 内容铁律）· `apps/bff/src/server.ts` 的 `/api/jobs/:id/events`（**轮询 SSE 范式**：写 `text/event-stream` 头 → 循环把"自 `sent` 起的新事件"`data: …\n\n` 推出去；协同的 op 流直接复用这个范式，**无需 WebSocket**）· `apps/web/src/lib/sse.ts`（`useSSE`）· `packages/harness-core/src/workspace`（版本化文件区，做协同文档的持久化落点）· `apps/bff/src/auth.ts`（签名 token 范式，做 share-link）· Sprint 01（SSE）· Sprint 07（工作区）· Sprint 10（owner 隔离/限流/审计）· Sprint 14/20（签名 token）。
> 目标产物（Sprint Demo）：**两个客户端（两个标签页/两个用户）打开同一个协同文档，一边打字、另一边**实时**看到；并发编辑**收敛**（CRDT，任意 op 顺序 → 同一文本）；文档可**分享**（签名 share-link，打开即获访问），未分享者**拒访问**（fail-closed）；能看到"谁在编辑"。** 全程走既有 SSE/HTTP（无新 WebSocket），owner/share 访问受控、限流、审计、追踪。

## 0. Sprint 范围与非目标

**主题**：二十个 Sprint 把 Apolla 做成了能力齐备、安全、可观测、可被生态调用的**单人**工作台——但还差**多人实时协同**这个产品级差异化。本 Sprint 加上它：一个**确定性收敛的 CRDT 文档**（offline 可测）+ 复用既有 **SSE/HTTP 做实时 op 同步**（不引入 WebSocket）+ 一个**分享/访问**模型（签名 share-link，复用 token 范式）。这既是产品的一大步，也仍是 harness 风格——把"实时同步通道"当作可换挡的传输、把 CRDT 当作纯确定性核心，二者都 hermetic 可测。

**做（本 Sprint 的闭环）**
- CRDT 核心：**RGA 文本序列**（`insert(afterId, char, id)` / `delete(id)`，`id = replicaId:counter` 全局唯一、并发同位插入按 id 确定排序、删除墓碑、materialize 还原文本）。**确定性收敛**：同一组 op 任意顺序应用 → 同一文本。
- 协同会话：`CollabSession`（op 日志 append-only + apply + `opsSince(seq)` + presence 在场者）；`CollabRepository`（内存会话按 docId；落 workspace 快照持久化，重开可恢复）。
- 同步传输（复用 SSE）：`POST /api/collab/:docId/ops`（上行：应用 + 追加 op 日志）+ `GET /api/collab/:docId/events?since=N`（下行 **SSE**：流式推"自 N 起的新 op" + presence）。owner/share 访问受控、owner-scoped、限流、审计、追踪。
- 分享/访问：owner 生成 **share-link**（签名、限文档、可选过期，复用 S14/S20 token 范式）；他人打开即获该文档访问；所有协同端点**访问检查**（owner 或被分享者，否则 fail-closed）；可列在场协作者。
- Web 协同编辑器：一个**实时文本面**——`useSSE` 订阅 op 流 → 应用远端 op；本地编辑算出 op → 上行；显示文档 + **在场者**；新建/打开协同文档 + **分享**控件（复制 share-link）+ 打开 share-link 落地。
- 安全：**远端 op 是数据**（只改共享文档，绝不触发工具/动作）；访问跨用户 fail-closed（除非显式分享）；share token 签名、限文档、不入日志；文档内容 untrusted（安全渲染）。
- 质量闸门：CRDT 收敛（并发 op 任意顺序 → 同文本）；两客户端经服务器同步（A 改 → B 见）；访问控制（未分享拒、分享放行）；share-link 授权；presence；eval；全程 hermetic（进程内两客户端，无浏览器/WebSocket）。

**不做（留待 Sprint 22+）**
- 富文本/格式 CRDT（本 Sprint 纯文本/结构化）；**光标/选区 presence**（只做"谁在场"，不做协同光标）；离线 op 队列 + 断线重连/重放深度；OT（操作变换）；冲突合并 UI / suggestions/comments 模式。
- 真实 **WebSocket** 传输（SSE+POST 够用，留作低延迟优化）；presence 头像/状态深度；协同文档的版本历史深度。
- 把协同接进 Cowork/Agent 自治回路；多文档工作区的实时索引；端到端加密协同。

**全程铁律**（违反即返工，见 [AGENTS.md](../AGENTS.md)）：**CRDT 确定性收敛**——同一组 op **任意顺序**应用必得**同一状态**（这是协同正确性的命脉，必须有测试钉死）；**协同访问 owner/share 受控**——跨用户访问/编辑共享文档**默认 fail-closed**，仅 owner 或被显式分享者可访问；share 授权可审计、（若设过期）到期失效；op 同步**owner-scoped + 限流 + 审计 + 追踪**；**远端 op 是数据**（只 mutate 共享文档，绝不据 op 触发工具/研究/扣费/高风险动作）；**share token 签名 + 限文档**（+ 可选过期），不入日志/响应（仅经分享通道）；复用既有 **SSE + owner 隔离 + token 签名 + workspace 持久化**（不旁路）；文档内容 untrusted（安全 Markdown/文本渲染）；离线 hermetic（进程内两客户端，无浏览器/WS/网络）；改动集中在 `contracts`、`harness-core`(collab)、`apps/bff`、`apps/web`、`docs`、`evals`；每个能力配测试。

---

## 里程碑 A — CRDT 核心 + 协同会话

### S21-T1 · RGA 文本 CRDT
- **做**：`harness-core/src/collab/rga.ts`：`Rga`（`insert(afterId|null, ch, id)` / `delete(id)` / `text()` / `apply(op)` / `ops()`）；op 类型（insert/delete，含 `id=replicaId:counter`）；并发同位插入按 `id` 全序确定排序；删除墓碑保留。`contracts` 加 `CollabOp`。
- **DoD**：单测：两个副本各自插入再交换 op（**任意顺序**）→ `text()` 相同（收敛）；删除收敛；同位并发插入确定排序；幂等（重复 op 不重复应用）。
- **改动**：`harness-core/src/collab/rga.ts`、`contracts/src/collab.ts`。
- **依赖**：无（纯数据结构）。

### S21-T2 · CollabSession + 仓库
- **做**：`CollabSession`（持 `Rga` + op 日志 append-only + `applyOps(ops)` 去重追加 + `opsSince(seq)` + presence：`join(userId)`/`leave`/`present()`）。`CollabRepository`（内存：按 docId 取/建会话）；`snapshot()`/`restore()` 与 workspace 互通（协同文档落 `collab/<docId>` 持久化，重开恢复）。
- **DoD**：applyOps 幂等 + 有序；opsSince 返回增量；presence 反映在场；快照→恢复后 `text()` 不变。
- **依赖**：S21-T1、S07 workspace。

---

## 里程碑 B — 同步传输 + 分享

### S21-T3 · SSE op 同步端点
- **做**：BFF —— `POST /api/collab/:docId/ops {ops, replicaId}`（访问检查 → `session.applyOps` → 200，含新 `seq`）；`GET /api/collab/:docId/events?since=N`（**SSE**，复用轮询范式：流式推自 N 起的新 op + presence；客户端在场标记）。owner/share 访问检查、限流、审计、追踪 span。
- **DoD**：A 上行 op → B 的 SSE 收到；`since` 增量正确；无访问权 → 403；落审计 + span；op 内容不触发任何动作。
- **改动**：`apps/bff/src/server.ts`、harness 暴露 collab。
- **依赖**：S21-T2、S01 SSE、S10 限流/审计、S17 追踪。

### S21-T4 · 文档分享 / 访问控制
- **做**：`POST /api/collab/:docId/share`（owner → 签名 share-link，限该 docId、可选过期）；`POST /api/collab/share/accept {token}`（验签 → 给当前用户加该文档访问）；`CollabAccessRepository`（docId → 允许的 userId 集合，内存 + Postgres）。所有 collab 端点：`ownerId===doc.owner || access.has(docId,userId)` 否则 **403 fail-closed**。
- **DoD**：owner 生成 link → 他人 accept → 可读写该文档；未分享者访问 403；share token 验签/限文档/（设了则）过期；授权落审计。
- **依赖**：S21-T3、S14/S20 token 范式、S10 owner 隔离。

---

## 里程碑 C — Web 协同编辑器

### S21-T5 · 实时编辑面
- **做**：`apps/web` 协同编辑器：新建/打开协同文档；`useSSE` 订阅 `/events` → 应用远端 op 到本地 `Rga` → 重渲染文本面（textarea）；本地输入 diff 出 insert/delete op → 上行；显示文档文本。（并发下光标可能跳动——已知限制、标注。）
- **DoD**：浏览器：两个标签页同文档，一边打字另一边实时更新；组件测试（mock SSE + fetch + CRDT）。
- **依赖**：S21-T3、S09 前端、S21-T1。

### S21-T6 · Presence + 分享 UI
- **做**：编辑器显示**在场协作者**（来自 presence）；"**分享**"控件（生成并复制 share-link）；打开 share-link 的落地（`/collab/accept?token=` → accept → 进入文档）。
- **DoD**：浏览器：看到在场者；点分享得 link；他人开 link → 进入并可编辑；组件测试。
- **依赖**：S21-T4/T5。

---

## 里程碑 D — 质量闸门

### S21-T7 · Eval/测试扩展
- **做**：CRDT **收敛**（并发 op 任意顺序 → 同文本、删除收敛、同位排序确定、幂等）；**两客户端经服务器同步**（进程内：A `POST ops` → B `opsSince`/SSE 见，收敛）；**访问控制**（未分享 403、share accept 后放行、跨用户 fail-closed）；share-link 验签/限文档/过期；presence；Web 组件（mock SSE/fetch）。可加 1 项 eval（CRDT 收敛 + 同步往返）。全程 hermetic（进程内、无浏览器/WS）。
- **DoD**：`pnpm test` + `pnpm test:web` + `pnpm e2e` 全绿且 hermetic；故意破坏（CRDT 不收敛 / 跨用户可访问 / op 触发动作 / share 不验签）任一即变红。
- **依赖**：S21-T1…T6。

### S21-T8 · 文档回写
- **做**：README（协同：开协同文档、分享、实时同步、CRDT 收敛、访问语义）；ARCHITECTURE（§实时加 CRDT + SSE op 同步 + share 访问；数据流 编辑→op→SSE 广播→收敛）；CLAUDE/AGENTS（协同铁律）；Sprint 21 DoD 勾选。
- **DoD**：新人照 README 开两端协同 + 分享跑通；文档准确。
- **依赖**：S21-T1…T7。

---

## 执行顺序与并行建议

```
S21-T1(RGA CRDT) ─ S21-T2(会话+仓库) ─ S21-T3(SSE op 同步) ─┬─ S21-T4(分享/访问)
                                                            ├─ S21-T5(实时编辑面)
                                                            └─ S21-T6(presence/分享 UI)
                                                 全部收口 → S21-T7(测试) → S21-T8(Docs)
```
- **关键路径**：S21-T1（CRDT 收敛）→ S21-T2（会话）→ S21-T3（SSE 同步）是地基；分享/访问、编辑面、presence 在其上并行。
- **每完成一个任务**：跑该模块测试 + 既有回归 + `pnpm e2e`；一任务一 PR，CI 绿即合。
- **建议 PR 分组**：A(T1+T2) · B(T3+T4) · C(T5+T6) · D(T7+T8)。

## Sprint 21 Definition of Done（整体验收）
- [x] RGA 文本 CRDT（确定性收敛、同位排序、幂等）+ `CollabOp` 契约。
- [x] `CollabSession`（op 日志 + opsSince + presence + snapshot/restore）+ 仓库（内存）。
- [x] SSE op 同步端点（上行 ops / 下行 SSE / 拉取），owner/share 访问受控 + 限流 + 审计 + 追踪。
- [x] 文档分享（签名 share-link + accept + `CollabAccessRepository` 内存+Postgres），跨用户 fail-closed。
- [x] Web 实时编辑面 + presence + 分享 UI（两端实时同步）。
- [x] 安全：CRDT 收敛、访问 fail-closed、op 是数据、share token 签名不入日志。
- [x] `pnpm test` + `pnpm test:web` + `pnpm e2e` 全绿且 hermetic（进程内两客户端）。
- [x] README/架构文档更新。

> **Sprint 21 完成**（PR [#116](https://github.com/Timsunzhuping/ApollaAIStudio/pull/116) A · [#117](https://github.com/Timsunzhuping/ApollaAIStudio/pull/117) B · [#118](https://github.com/Timsunzhuping/ApollaAIStudio/pull/118) C · D 本次）。**RGA 文本 CRDT**（`replica:counter` id、insert-after + 墓碑、并发同位按 id 全序排序、delete-before-insert 处理）——状态是 op 集合纯函数，**任意顺序收敛**；`CollabSession`（CRDT + append-only op 日志 + `opsSince` + presence + snapshot/restore）+ `InMemoryCollabRepository`。同步**复用既有 SSE/HTTP**（无 WebSocket）：`POST …/ops` 上行 / `GET …/events` SSE 下行 / `GET /api/collab/:docId` 拉取。**分享**：owner 签名 share-link（限该 docId、7 天）+ `share/accept` 授权 + `CollabAccessRepository`（内存 + Postgres `collab_access`），**fail-closed**。Web Collab 页（实时编辑面 + presence + 分享）；纯 CRDT 经 `@apolla/harness-core/collab` 子路径供前端。**远端 op 是数据**（绝不触发动作）。新增 eval `collab-convergence`(43)。324 root + 27 web + 9 e2e 绿。富文本/协同光标/离线队列/OT/真实 WebSocket 列为后续。

## 风险与提示（给代理）
- **收敛是命脉**：CRDT 必须对**任意 op 顺序**收敛到同一状态——用"两副本交换 op、打乱顺序应用"的测试钉死；同位并发插入用 `id` 全序确定排序（别用时间戳）。
- **复用 SSE，不上 WS**：op 下行直接套 `/api/jobs/:id/events` 的轮询 SSE 范式（写 event-stream、循环推自 `since` 起的新 op）；上行普通 POST。两客户端进程内即可测，无需浏览器/WebSocket。
- **访问 fail-closed**：协同端点先查 `owner || shared`，否则 403；share token 验签 + 限该 docId（payload 带 docId），别让一个 token 通吃所有文档；设了过期就校验。
- **op 是数据**：远端 op 只能 mutate 共享文档的 CRDT，**绝不**据 op 内容触发工具/研究/扣费/任何动作；文档内容 untrusted，安全渲染。
- **持久化**：协同会话内存为主 + 落 workspace 快照（`collab/<docId>`）；重开从快照恢复，避免重启丢文档。
- **限流/审计**：ops/events/share 端点限流（防刷 op），授权 + 关键操作落审计。
- **UI 诚实**：纯文本 textarea + op 应用，并发下光标跳动是已知限制（本 Sprint 不做协同光标），标注；测试以 CRDT/传输层 hermetic 为主、UI 薄。
- **不确定/不可逆**（CRDT id 方案、op 批量/节流、share TTL、快照频率、presence 心跳间隔、docId 命名）→ 选保守默认并在 PR 标注。
