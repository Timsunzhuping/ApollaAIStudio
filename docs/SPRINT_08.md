# Sprint 08 执行单 — Text Product Surfaces：翻译 + 表格 + 会议纪要

> 读者：**Codex / Claude Code**。逐任务从上往下执行；每个任务自带验收（DoD）、依赖、改动位置。
> 前置必读：[ARCHITECTURE.md](./ARCHITECTURE.md) §3.3/§3.6/§3.9 · [AGENTS.md](../AGENTS.md) · [PRD.md](./PRD.md)（Monica/Genspark 文本能力）· Sprint 01–07（已完成）。
> 目标产物（Sprint Demo）：**粘贴会议转写 → Meeting Notes → 结构化纪要（摘要/决策/行动项）存为 `notes.md`；翻译 `report.md` → `report.en.md`（保结构）；从提示生成对比表 → `table.csv`，再"加一列：pros" → 新版本。** 全部落工作区（版本/审计/配额，复用 Sprint 07），全链路走 Harness Core，不旁路。

## 0. Sprint 范围与非目标

**主题**：在 Sprint 07 的版本化工作区之上，落地 Monica/Genspark 式的**文本产品面**——但不是三个一次性 prompt，而是一个统一的**文档变换（Document Transform / Surface）substrate**：每个 surface = 声明式定义（输入类型 + 参数 schema + promptRef + 输出 mime + executor 类型），由一个 SurfaceRuntime 调度，复用 Prompt Registry + Model Router + Workspace + Safety + Cost。新增一个产品面 ≈ 一条配置 + 可选 executor，不重写管线（capability-as-config）。首批三个面：**翻译、表格、会议纪要**。

**做（本 Sprint 的闭环）**
- Surface substrate：`Surface` 契约（id/title/inputKind: text|doc/params schema/promptRef/outputMime/executor）+ `SurfaceRuntime`（按 executor 类型分派；结构化输出经 zod 校验；产物写入工作区——版本/审计/配额复用 S7）。内置 surface 声明在 `config/surfaces/*`。
- **翻译**面：文本或工作区文档 → 目标语言译文（保 Markdown 结构）；语言参数；产出新文档/新版本（流式）。
- **表格**面：提示或源文档 → **结构化表格**（rows/cols，zod 校验）→ 存为 `.csv` + Markdown；对已有表"AI 加一列 / 汇总"变换产新版本。（非公式计算引擎——那是后续。）
- **会议纪要**面：转写文本 → 结构化 `{summary, decisions[], actionItems[{owner,task,due}]}`（zod）→ Markdown 存盘；列出行动项跟进。
- 交付与安全：Surfaces UI（选面 → 文本/选工作区文件输入 → 设参数 → 跑 → 看产物 + 落盘文件）；surface 安全（产物经工作区 guard：路径/配额/审计；输入文档内容走 untrusted 数据通道；结构化解析失败安全降级；成本计量）。
- 质量闸门：翻译/表格/会议纪要/产物落工作区/结构化校验失败处理 的 eval；文档 + Demo。

**不做（留待 Sprint 09+）**
- 全功能表格引擎（公式/计算/图表）、富文本所见即所得编辑器、实时协同（CRDT）。
- 音频→转写（live transcription / ASR）——会议纪要以**文本转写**为输入；语音留待专门 Sprint。
- 裸机本地目录、生产级 Next.js 前端、HTTP/SSE MCP transport、Plugin/连接器市场、分布式队列。
- 行动项自动建定时任务/通知（可作为**可选轻 tie-in** 提及，核心只做结构化抽取 + 落盘）。

**全程铁律**（违反即返工，见 [AGENTS.md](../AGENTS.md)）：surface 输入（尤其工作区文档/转写）是 **untrusted 数据**（进数据通道，不当指令）；产物一律经**工作区 guard**（路径规范化 + 配额 + 写入审计，复用 S7-T6）；**禁内联 prompt**（声明式 `config/prompts/*.md`，surface 经 promptRef 引用）；**禁硬编码模型名**（用别名）；结构化输出经 **zod 校验**，失败安全降级（不崩、可重试）；每次 LLM 调用计入 Cost Ledger；改动集中在 `contracts`/`harness-core`/`config`/`evals`/`apps`；每个 surface 配 eval。

---

## 里程碑 A — Surface substrate + 翻译

### S8-T1 · Surface 契约 + SurfaceRuntime
- **做**：`contracts` 加 `Surface`（id/title/inputKind/paramsSchema/promptRef/outputMime/executor: 'translate'|'sheet'|'notes'|'generic'）。`harness-core/src/surface/runtime.ts`：`SurfaceRuntime.run(surface, input)` —— 解析输入（text 直用 / doc 经 workspace.read 进数据通道）→ 按 executor 分派（generic = 流式改写）→ 产物写工作区（经注入的 WorkspaceRepository，已是 Guarded）。内置 surfaces 声明在 `config/surfaces/*.json` + `loadSurfaces()`。
- **DoD**：注册一个 generic surface，给文本输入 → 产出写入工作区指定 path（版本化）；doc 输入经 workspace 读取且作为数据通道证据；未知 surface/参数非法报错而非崩。
- **改动**：`contracts/src/surface.ts`、`harness-core/src/surface/*`、`config/surfaces/*` + `config` 加载器、`harness-core/index.ts`。
- **依赖**：Sprint 03 Prompt Registry、Sprint 07 Workspace。

### S8-T2 · 翻译面
- **做**：`translate` executor：文本/文档 → 目标语言译文，保 Markdown 结构。参数 `{ targetLang, sourceLang? }`。流式产出，写入工作区（doc 输入默认产 `<name>.<lang>.md`，文本输入产指定 path）。prompt `config/prompts/surface.translate.md`。
- **DoD**：把 `report.md`（中文）翻译为英文 → 产出 `report.en.md`，结构（标题/列表）保留；离线 demo 也能产出可见译文。
- **依赖**：S8-T1。

---

## 里程碑 B — 表格 + 会议纪要

### S8-T3 · 表格面
- **做**：`sheet` executor：提示或源文档 → **结构化表格** `{ columns: string[], rows: string[][] }`（zod，经 `router.json`）→ 存为 `.csv`（+ 可选 Markdown 表）。再支持对已有表的变换：`addColumn`（AI 按列名补全每行）/`summarize`。变换产新版本。prompt `config/prompts/surface.sheet.md`。
- **DoD**：从"对比 A/B/C 三款产品"生成表 → `table.csv`（合法 CSV，列/行齐整）；对其"加一列：pros" → 新版本多一列、行数不变；结构化输出非法时安全降级（报错不崩）。
- **依赖**：S8-T1。

### S8-T4 · 会议纪要面
- **做**：`notes` executor：转写文本 → 结构化 `{ summary, decisions: string[], actionItems: {owner, task, due?}[] }`（zod，`router.json`）→ 渲染 Markdown 存工作区。列出行动项（可选轻 tie-in：返回行动项供前端"建跟进"，但本 Sprint 不自动建定时任务）。prompt `config/prompts/surface.notes.md`。
- **DoD**：粘贴一段会议转写 → 产出 `notes.md`，含摘要 + 决策列表 + 行动项（owner/task）；行动项结构化可枚举；离线 demo 产确定性结构。
- **依赖**：S8-T1。

---

## 里程碑 C — 交付与安全

### S8-T5 · Surfaces UI
- **做**：Demo 加 **Surfaces 面板**：选面（翻译/表格/会议纪要）→ 输入（粘文本 或 选工作区文件）→ 设参数（目标语言/表变换等）→ 跑 → 看产物预览 + 落盘文件名（接入 Sprint 07 文件树/版本/下载）。
- **DoD**：浏览器里走通 Sprint Demo 三条：会议纪要、翻译、表格（含加列）；产物即时出现在工作区文件树、可看版本/下载。
- **依赖**：S8-T2/T3/T4、Sprint 07 Workspace UI。

### S8-T6 · Surface 安全 + 结构化健壮性
- **做**：产物一律经工作区 guard（路径/配额/审计）；surface 输入（doc/转写）走 untrusted 数据通道；**结构化输出 zod 校验**，失败 → 安全降级（明确错误 + 不写半成品）；每次 LLM 调用计入 Cost Ledger；surface 按 owner 隔离。
- **DoD**：单测：非法结构化输出被 zod 拦截、不写盘、报清晰错误；越界 path 产物被 guard 拒；surface 产物落审计；注入式输入（文档里"忽略指令"）不改变行为。
- **依赖**：S8-T1…T4、Sprint 07 guard。

---

## 里程碑 D — 质量闸门

### S8-T7 · Eval 扩展（Surfaces）
- **做**：扩 `evals/`：①翻译（产出语言/结构保留）②表格（合法结构化表 + addColumn 行数不变/列+1）③会议纪要（行动项结构化抽取）④surface 产物落工作区（版本化）⑤结构化校验失败被拦截 + 不写盘。CI 用 stub/Mock（确定性、离线）。
- **DoD**：`pnpm eval` 覆盖以上 5 项（总数 29→34）；CI 必过；故意破坏（译文不写盘 / 表列错乱 / 纪要无行动项 / 非法结构化被写盘）任一即变红。
- **依赖**：S8-T1…T6。

### S8-T8 · 文档回写 + Demo 升级
- **做**：更新 README/ARCHITECTURE/CLAUDE/AGENTS（Surface substrate + 三个文本面；eval 计数 29→34）。Demo 端到端走通（离线可演示），Sprint 08 DoD 勾选。
- **DoD**：新人/新代理按 README 一条命令起本地；命令与实际一致；Demo 端到端可演示。
- **依赖**：S8-T1…T7。

---

## 执行顺序与并行建议

```
S8-T1(Surface substrate) ─ S8-T2(翻译) ─┬─ S8-T3(表格)
                                         ├─ S8-T4(会议纪要)
                                         ├─ S8-T6(安全/健壮)
                                         └─ S8-T5(Surfaces UI)
                              全部收口 → S8-T7(Eval) → S8-T8(Docs/Demo)
```
- **关键路径**：S8-T1（substrate）是地基；翻译/表格/会议纪要三面并行（各是一个 executor + 一条 prompt + 一条 config）。
- **每完成一个任务**：跑该模块单测 + 相关 eval；一任务一 PR，CI 绿即合；提交说明写清「动了哪个注册点 + 加了哪个 eval」。
- **建议 PR 分组**：A(T1+T2) · B(T3+T4) · C(T5+T6) · D(T7+T8)。

## Sprint 08 Definition of Done（整体验收）
- [x] Surface substrate：声明式 surface（输入类型 + 参数 schema + promptRef + 输出 mime + executor），SurfaceRuntime 分派；新增面 ≈ 配置 + executor，不改管线。
- [x] 翻译：文本/文档 → 目标语言译文（保结构）→ 落工作区（新文档/版本）。
- [x] 表格：提示/文档 → 合法结构化表 → `.csv`；addColumn/summarize 变换产新版本。
- [x] 会议纪要：转写 → 结构化（摘要/决策/行动项）→ `notes.md`；行动项可枚举。
- [x] 安全：产物经工作区 guard（路径/配额/审计）；输入走数据通道；结构化 zod 校验失败安全降级、不写半成品；成本计量。
- [x] `pnpm eval` 含 翻译/表格/会议纪要/产物落工作区/结构化失败拦截（34 项）；CI 全门禁绿。
- [x] README/命令/架构文档一致更新；Demo 端到端走通（离线可演示）。

> **Sprint 08 完成。** S8-T1–T8 全部合并到 main（PR #51–#53 + 本 PR）。34 项 eval 全绿（研究 6 + 媒体 4 + 执行 5 + 自治 4 + Cowork 5 + Workspace 5 + Surfaces 5）。离线端到端验证：会议转写 → `notes.md`；翻译 `report.md` → `report.en.md`（保结构）；对比表 `table.csv` → 加列 → v2（列+1、行不变）。

## 风险与提示（给代理）
- **substrate 优先，别写三个一次性 prompt**：先把 Surface 契约 + Runtime 做对，三个面只是配置 + executor；否则后续每个新面都要重写管线，违背 harness 杠杆。
- **结构化输出必校验**：表格/纪要走 `router.json` + zod；非法输出**不写盘**、报清晰错、可重试——半成品落工作区比报错更糟。
- **输入即不可信**：文档/转写内容进数据通道作证据，绝不当指令（注入防御与工具输出一视同仁）。
- **产物只走 guard**：所有写入经 Sprint 07 的 GuardedWorkspaceRepository（路径规范化 + 配额 + 审计），surface 不另开写通道。
- **离线可演示**：demo adapter 为三个面各加确定性分支（译文/表/纪要），CI 全程离线。
- **不做公式引擎/ASR**：表格是结构化数据 + AI 列变换；会议纪要输入是文本转写。语音与计算引擎留待后续。
- **不确定/不可逆**（产物默认命名、表变换语义、纪要 schema 字段）→ 选保守默认并在 PR 标注。
