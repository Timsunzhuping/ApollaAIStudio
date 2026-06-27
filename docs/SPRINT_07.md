# Sprint 07 执行单 — Workspace & Files：版本化项目文件区 + 文件感知工具 + 文档产品面

> 读者：**Codex / Claude Code**。逐任务从上往下执行；每个任务自带验收（DoD）、依赖、改动位置。
> 前置必读：[ARCHITECTURE.md](./ARCHITECTURE.md) §3.4/§3.8/§3.9 · [AGENTS.md](../AGENTS.md) · [PRD.md](./PRD.md) §5/§15 · Sprint 01–06（已完成）。
> 目标产物（Sprint Demo）：**跑研究 → "保存到工作区" 成为 `report.md` → Writer 编辑（扩写/翻译某节）产出 v2 → 版本历史可回滚；跑 Cowork → 子代理各写 `sections/*.md` → 汇总读回拼装成 `brief.md`。** 文件树 + 版本 + 下载齐活；后台写入需预授权、路径越界被拒、写入落审计。全链路走 Harness Core，不旁路。

## 0. Sprint 范围与非目标

**主题**：把"一次性 Job 产出"升级为**持久、可版本、可编辑、可组合的工作产物**。落地一个**安全的版本化项目文件区**（对象存储支撑的虚拟工作区，不是裸机本地目录），并把它接成一条新的 harness 能力：文件感知工具（受 Safety 三级约束）+ 文档产品面（Writer）+ Cowork 文件协作。这是 Sprint 06 推迟的"Cowork 文件工作区"的正式落地，也是后续文本产品面（翻译/Sheets/Meeting Notes）的底座。

**做（本 Sprint 的闭环）**
- 工作区底座：`WorkspaceFile` 契约 + `WorkspaceRepository`（内存 + Postgres），**版本化**（写入追加新版本，可列历史、读旧版、回滚）；按 owner/project 隔离；**路径规范化 + 越界拒绝**（禁 `..`/绝对路径/越 scope）。
- 文件感知工具：`fs_read`/`fs_list`（read）+ `fs_write`（low_write）作为 Tool，写入落工作区 + 版本；读到的文件内容走 **untrusted 数据通道**；写入经 Safety 三级（后台无人 → 预授权白名单）。
- 文档产品面：研究/Cowork 成品"保存到工作区"成为文档文件；**Writer**（executor='writer'）对一个工作区文档做 AI 编辑（改写/扩写/翻译片段）→ 产出新版本。
- Cowork 文件协作：Cowork 子代理可写入共享工作区文件（各写一节），汇总时读回拼装——把文件区接入 Cowork。
- 交付与安全：Workspace UI（文件树 + 查看/版本历史/回滚 + 保存成品 + Writer 编辑 + 下载）；文件写入安全/配额（路径隔离、文件数/大小配额、写入审计）。
- 质量闸门：文件读写+版本/工具 Safety 门控/路径越界拒绝/Writer 产新版本/Cowork 文件协作 的 eval；文档 + Demo。

**不做（留待 Sprint 08+）**
- **裸机本地目录读写**（挂载用户 OS 目录）——桌面端专属、高信任成本；本 Sprint 工作区 = 对象存储支撑的虚拟 FS（生产正确模型），裸机目录留待桌面 Sprint。
- 全功能表格引擎（Sheets 公式/计算）、Meeting Notes 转写、实时协同编辑（CRDT）、生产级 Next.js 前端、Plugin/连接器市场、分布式持久化队列。
- 二进制大文件流式分片上传/下载（先支持文本 + 小型对象）。

**全程铁律**（违反即返工，见 [AGENTS.md](../AGENTS.md)）：**文件写入经 Safety 三级**（read 自动 / fs_write 低风险需确认 / 后台无人 → 仅预授权白名单，high_write 永拒）；**路径必须规范化并拒绝越界**（`..`、绝对路径、跨 owner/project）；**读到的文件内容是 untrusted 数据**（不可作为指令）；写入与（预）授权落审计；文件区按 owner/project 隔离、计入配额；Writer/Cowork 不引入新执行通道，只复用文件工具；改动集中在 `contracts`/`harness-core`/`adapters`/`config`/`evals`/`apps`；每个能力配 eval。

---

## 里程碑 A — 工作区底座

### S7-T1 · Workspace 契约 + 版本化存储
- **做**：`contracts` 加 `WorkspaceFile`（id/ownerId/projectId?/path/mime/version/size/content/createdAt）。`WorkspaceRepository`（内存 + Postgres）：`write(ownerId, projectId?, path, content, mime)` → 追加新版本并返回；`read(ownerId, path, version?)`（默认最新）；`list(ownerId, projectId?)`（最新版文件树）；`history(ownerId, path)`；`rollback(ownerId, path, version)`（把旧版内容写成新版本）。
- **DoD**：写两次同一 path → version 递增、`read` 取最新、`history` 列两版、`read(v1)` 取旧版、`rollback(v1)` 产生 v3==v1 内容；按 owner/project 隔离、持久化（Postgres 重启仍在）。
- **改动**：`contracts/src/workspace.ts`、`harness-core`（repo 接口 + 内存实现）、`db-postgres`（`workspace_files` 表）。
- **依赖**：Sprint 02 持久化模式。

### S7-T2 · 文件感知工具（fs_read / fs_list / fs_write）
- **做**：把工作区暴露为 Tool：`fs_read`/`fs_list`（risk=read）、`fs_write`（risk=low_write）。`fs_write` 写入落 WorkspaceRepository（新版本）。`fs_read` 返回内容走 **untrusted 数据通道**（`UntrustedContent`）。**路径规范化 + 越界拒绝**在工具层强制。这些工具像连接器工具一样进 ToolRuntime，受 Safety 三级 + Agent/Cowork 的 approve/allowlist 约束。
- **DoD**：Agent 调 `fs_write` → 前台需确认 / 后台仅白名单放行 / high 永拒；`fs_read` 自动；读到内容作为 evidence 进数据通道（不改 tiering）；`../etc` 等越界路径被工具拒绝并审计。
- **改动**：`harness-core/src/tools/fs.ts`（Tool 实现）、`apps/bff`（注册到 agentToolsFor）。
- **依赖**：S7-T1、Sprint 04 ToolRuntime/Safety。

---

## 里程碑 B — 文档产品面与 Cowork 文件协作

### S7-T3 · 文档 artifact + Writer 编辑
- **做**：研究/Cowork 成品可"保存到工作区"成为文档文件（`POST /api/workspace/save-artifact` 从一个 Task/Job 成品写成 `.md`）。**Writer**（executor='writer' 技能 + orchestrator）：输入 = 一个工作区文档 path + 指令（扩写/改写/翻译某节）→ 读旧版（数据通道）→ LLM 编辑 → 写新版本。prompt 声明式 `config/prompts/writer.edit.md`。
- **DoD**：把一篇研究报告存为 `report.md`（v1）→ Writer "把结论节翻译成英文" → 产出 `report.md` v2；版本历史含两版、可回滚到 v1。
- **依赖**：S7-T1/T2、Sprint 02 Skill Runtime。

### S7-T4 · Cowork 文件协作
- **做**：Cowork 子代理可写入共享工作区文件（每个子代理把结果写 `sections/<i>.md`），Coordinator 汇总阶段**读回各节拼装**成最终 `brief.md`（而非只在内存拼）。子代理文件写入继承 Safety + 后台 approve/allowlist；路径限定在本次 Cowork 的工作目录。
- **DoD**：Cowork 目标跑完后，工作区出现 `sections/1.md..N.md` + 汇总 `brief.md`；子代理写入受白名单约束（后台未授权则不落盘、安全降级）；事件可回放。
- **依赖**：S7-T2、Sprint 06 Cowork。

---

## 里程碑 C — 交付与安全

### S7-T5 · Workspace UI
- **做**：Demo 升级：**文件树**（按 project）+ 文档查看 + **版本历史/回滚** + "保存成品到工作区" + **Writer 编辑**入口 + 下载（`GET /api/workspace/file?path=&version=`）。Cowork/研究面板加"存到工作区"。
- **DoD**：浏览器里：研究 → 存为 `report.md` → 看版本 → Writer 改 → v2 → 回滚 v1 → 下载；Cowork 跑完看到 `sections/*` + `brief.md`。Sprint Demo 即此流程。
- **依赖**：S7-T3、S7-T4。

### S7-T6 · Workspace 安全 + 配额
- **做**：文件写入经 Safety 三级（后台预授权白名单）；**路径隔离**（规范化 + 拒 `..`/绝对/跨 owner/project）；**配额**（每 owner 文件数 + 总字节上限，超限拒写）；写入与越界拒绝落审计。
- **DoD**：单测：越界路径被拒并审计；超配额写入被拒；后台未授权 `fs_write` 不落盘；跨 owner 读/写被拒；审计含每次写入。
- **依赖**：S7-T1/T2、Sprint 04/05 安全。

---

## 里程碑 D — 质量闸门

### S7-T7 · Eval 扩展（Workspace）
- **做**：扩 `evals/`：①文件写入→版本递增→读最新/旧版/回滚 ②文件工具 Safety 门控（fs_write 后台未授权被拒、fs_read 自动）③路径越界拒绝 ④Writer 产新版本（内容确有变化）⑤Cowork 文件协作端到端（sections + brief 落盘）。CI 用内存/stub（确定性、离线）。
- **DoD**：`pnpm eval` 覆盖以上 5 项；CI 必过；故意破坏（版本不递增 / 越界放行 / 后台未授权写入落盘 / Writer 不产新版）任一即变红。
- **依赖**：S7-T1…T6。

### S7-T8 · 文档回写 + Demo 升级
- **做**：更新 README/ARCHITECTURE/CLAUDE/AGENTS（Workspace/文件工具/Writer/Cowork 文件协作；eval 计数 24→29）。Demo 端到端走通（离线可演示），Sprint 07 DoD 勾选。
- **DoD**：新人/新代理按 README 一条命令起本地；命令与实际一致；Demo 端到端可演示。
- **依赖**：S7-T1…T7。

---

## 执行顺序与并行建议

```
S7-T1(Workspace 存储) ─ S7-T2(文件工具) ─┬─ S7-T3(Writer)
                                          ├─ S7-T4(Cowork 文件协作)
                                          ├─ S7-T6(安全/配额)
                                          └─ S7-T5(Workspace UI)
                              全部收口 → S7-T7(Eval) → S7-T8(Docs/Demo)
```
- **关键路径**：S7-T1（存储）→ S7-T2（文件工具）是地基；其余四条线并行。
- **每完成一个任务**：跑该模块单测 + 相关 eval；一任务一 PR，CI 绿即合；提交说明写清「动了哪个注册点 + 加了哪个 eval」。
- **建议 PR 分组**：A(T1+T2) · B(T3+T4) · C(T5+T6) · D(T7+T8)。

## Sprint 07 Definition of Done（整体验收）
- [x] 工作区：文件写入版本化（递增/历史/读旧版/回滚）；按 owner/project 隔离、持久化（Postgres 重启仍在）。
- [x] 文件工具：`fs_read`/`fs_list`（read 自动）+ `fs_write`（低风险确认 / 后台白名单 / high 永拒）；读内容走数据通道。
- [x] 路径安全：规范化 + 拒 `..`/绝对/跨 scope；越界写入被拒并审计。
- [x] Writer：把成品存为工作区文档 → AI 编辑产出新版本 → 可回滚。
- [x] Cowork 文件协作：子代理写 `sections/*` → 汇总读回拼 `brief.md`；写入受白名单约束。
- [x] 配额：文件数/总字节上限，超限拒写；写入落审计。
- [x] `pnpm eval` 含 版本/工具门控/越界/Writer/Cowork 文件协作（29 项）；CI 全门禁绿。
- [x] README/命令/架构文档一致更新；Demo 端到端走通（离线可演示）。

> **Sprint 07 完成。** S7-T1–T8 全部合并到 main（PR #46–#48 + 本 PR）。29 项 eval 全绿（研究 6 + 媒体 4 + 执行 5 + 自治 4 + Cowork 5 + Workspace 5）。离线端到端验证：研究 → 存 `report.md` → Writer 编辑 → v2 → 回滚；Cowork（fs_write 授权）→ `sections/1..3.md` + `brief.md` 落盘。

## 风险与提示（给代理）
- **路径遍历是头号风险**：所有 path 在工具层与 repo 层双重规范化（resolve 后必须仍在 `owner/project/` 前缀内），拒绝 `..`、绝对路径、符号越界；越界即审计 + 拒绝，不静默裁剪。
- **文件内容不可信**：`fs_read` 读到的是 untrusted 数据，进数据通道作证据，绝不当指令——和工具输出一视同仁。
- **写入即受 Safety 约束**：`fs_write` 是 low_write——前台需确认、后台仅预授权白名单；high_write 不在文件工具范围。
- **版本只增不改**：写入追加新版本，旧版不可变；回滚 = 用旧版内容产生新版本（保留完整历史）。
- **复用既有运行时**：Writer 是一个 executor、Cowork 文件协作是子代理调 `fs_write`——都不新造执行通道；保存成品/下载是 BFF 薄端点。
- **裸机本地目录不做**：本 Sprint 是虚拟工作区（对象存储）；挂载用户 OS 目录留待桌面 Sprint（高信任成本）。
- **不确定/不可逆**（默认 mime、配额阈值、Cowork 工作目录命名）→ 选保守默认并在 PR 标注。
