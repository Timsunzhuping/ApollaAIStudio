# Sprint 06 执行单 — Cowork 模式：Plugins + 子代理编排 + 集成式自治

> 读者：**Codex / Claude Code**。逐任务从上往下执行；每个任务自带验收（DoD）、依赖、改动位置。
> 前置必读：[ARCHITECTURE.md](./ARCHITECTURE.md) §1/§3.9/§4/§9 · [AGENTS.md](../AGENTS.md) · [PRD.md](./PRD.md) §15 · Sprint 01–05（已完成）。
> 目标产物（Sprint Demo）：**安装「研究分析师」Plugin → 发起一个 Cowork 任务（"从 3 个角度研究 X 并写一份简报"）→ 协调器并行派生 3 个子代理各研究一个角度 → 汇总成简报 → 可存为每日定时任务（复用 Sprint 05）→ 审计可见全部子代理调用。** 不确定时主动澄清（前台问、后台安全跳过，绝不自答）。全链路走 Harness Core，不旁路。

## 0. Sprint 范围与非目标

**主题**：落地 PRD §15 的旗舰 **Cowork 模式**——把已建的全部能力（研究/媒体/Agent/技能/连接器/后台 Job/定时）整合为**按职能打包的 Plugins** + **子代理编排** + **澄清机制**的集成式自治模式。这是五个 Sprint 的收口：Sprint 05 已建好后台自治底座，本 Sprint 把它组织成可复用、可并行、可治理的 Cowork。

**做（本 Sprint 的闭环）**
- Plugins：声明式 Plugin 清单（bundle：skills + 所需连接器 + 子代理定义 + 命令别名）；按 owner 安装/卸载；安装后其 skills 并入该用户可用技能、所需连接器被标注。官方 Plugin 包（一键装）。
- 子代理编排：Coordinator 给定目标 → **并行派生 N 个子代理**（各为有界 agent 运行）→ 汇总综合。并发上限 + 子代理数上限 + 每个子代理审计 + 后台安全继承。
- Cowork 编排：集成式 `CoworkOrchestrator`（executor='cowork'）用已安装 Plugin 的 skills + 子代理追目标；可作为 Job 前台/后台/定时运行（复用 Sprint 05）。
- 澄清机制：Agent/Cowork 可发 `clarify` 提问并暂停等答（复用 confirm/mailbox 模式）；**后台无人 → 返回 null（绝不自答），安全跳过/降级**。
- 交付与安全：Cowork 工作区 UI（装/管 Plugin、跑 Cowork、看子代理 fan-out 轨迹 + 澄清 + 审计）；子代理继承 Safety 三级 + 后台规则；子代理总量/配额有界。
- 质量闸门：Plugin 安装/子代理 fan-out/澄清门控/Cowork 端到端/安全继承 的 eval；文档 + Demo。

**不做（留待 Sprint 07+）**
- 真实桌面文件区（授权本地目录读写）——高风险，留待专门 Sprint；本 Sprint 用项目/对象存储作为工作区。
- 文本产品面（翻译/Writer/Sheets/Meeting Notes）、生产级 Next.js 前端、HTTP/SSE MCP transport、连接器/Plugin 市场、分布式队列、企业 RBAC 完整体系。
- 高风险写入自动化（仍只到低风险 + 确认/预授权）。

**全程铁律**（违反即返工，见 [AGENTS.md](../AGENTS.md)）：子代理继承全部执行铁律——工具输出不可信、写入经 Safety 三级、后台无人确认（只读或预授权白名单，high_write 永拒）、调用落审计；**澄清绝不自答**；子代理 fan-out 有并发与总量上限（防失控）；Plugin/子代理/Cowork 运行计入配额、按 owner 隔离；改动集中在 `harness-core`/`adapters`/`config`/`evals`/`apps`；每个能力配 eval。

---

## 里程碑 A — Plugins

### S6-T1 · Plugin 清单 + 注册/安装
- **做**：`contracts` 加 `Plugin`（name/description/skills: SkillDef[]/connectors: 所需连接器声明/subAgents: 子代理定义/commands: 命令别名→skill）。`PluginRepository`（已安装，按 owner，内存 + Postgres）。安装：持久化 InstalledPlugin → 其 skills 并入该 owner 的 `SkillSource`（扩展 CompositeSkillSource）→ 所需连接器标注（未连接则提示）。卸载移除。
- **DoD**：安装一个 Plugin 后，其 skills 出现在 `skills.list(owner)`、可 match/run；卸载后消失；按 owner 隔离；所需但未连接的连接器在安装响应里被标注。
- **改动**：`contracts/src/plugin.ts`、`harness-core`（PluginRepository + SkillSource 接入）、`db-postgres`、`apps/bff`。
- **依赖**：Sprint 02 Skill Runtime、Sprint 04 连接器。

### S6-T2 · 官方 Plugin 包（config）
- **做**：声明式官方 Plugin（`config/plugins/*`）：如 `research-analyst`（research + summarize + cover-image skills）、`personal-assistant`（research + web-agent + daily 调度模板）。一键安装。
- **DoD**：列出官方 Plugin；一键安装 `research-analyst` → 其技能可用；新增官方 Plugin 无需改业务代码即可被列出/安装。
- **依赖**：S6-T1。

---

## 里程碑 B — 子代理编排与 Cowork

### S6-T3 · 子代理编排（并行 fan-out + 汇总）
- **做**：`harness-core/src/cowork/coordinator.ts`。`Coordinator.run(goal, subgoals[])`：对每个 subgoal **并行**跑一个有界子代理（agent run，受并发上限 + 步数上限），收集结果（数据通道），再用一次 LLM 综合。事件：`subagent-start/subagent-result/synthesize/done`。子代理继承 Safety + 后台 approve 策略。总子代理数上限护栏。
- **DoD**：用 stub LLM + stub 工具，3 个 subgoal → 3 个子代理并行完成 → 汇总输出；超并发/总量上限被钳制；事件可回放；子代理调用全部审计。
- **依赖**：Sprint 04 Agent、Sprint 04 审计。

### S6-T4 · Cowork 编排（集成式）
- **做**：`CoworkOrchestrator`（executor='cowork' 技能 + 直接 orchestrator）：给定目标 + 已安装 Plugin → 规划 subgoals（结构化）→ 调 Coordinator 派生子代理（用 Plugin 的 skills/工具）→ 汇总交付。可作为 Job 前台/后台/定时运行（复用 Sprint 05 JobRunner/Scheduler）。
- **DoD**：装 `research-analyst` → Cowork 目标「多角度研究并写简报」→ 规划 subgoals → 子代理并行 → 简报产出；同一 Cowork 可存为后台/定时 Job。
- **依赖**：S6-T1、S6-T3。

---

## 里程碑 C — 澄清机制

### S6-T5 · 澄清（clarify）
- **做**：Agent/Cowork 可发 `clarify(question)` 并暂停等人答（注入 `clarify(q): Promise<string|null>`，复用 mailbox：SSE 下发 + `POST .../clarify` 回传）。**后台/定时无人 → clarify 返回 null**：安全降级（用默认/标注"需澄清"），**绝不自答**。前台不确定/不可逆前先问。
- **DoD**：单测：前台 clarify 拿到答案后继续；后台 clarify 返回 null 不阻塞、不自答、安全降级。Demo：模糊目标 → 前台弹澄清 → 答后继续。
- **依赖**：S6-T3/T4。

---

## 里程碑 D — 交付与安全

### S6-T6 · Cowork 工作区 UI
- **做**：Demo 升级：Plugin 市场（列出/安装/卸载官方 Plugin + 显示所需连接器）、Cowork 任务（目标 → **子代理 fan-out 轨迹** + 澄清弹窗 + 汇总结果 + 审计面板）；可把 Cowork 存为定时任务。
- **DoD**：浏览器里装 Plugin → 跑 Cowork → 看子代理并行轨迹 → 澄清（如触发）→ 简报 → 审计。Sprint Demo 即此流程。
- **依赖**：S6-T2、S6-T4、S6-T5。

### S6-T7 · Cowork 安全 + 配额
- **做**：子代理继承 Safety 三级 + 后台规则（只读/预授权白名单，high_write 永拒）；**子代理总量/并发上限**（防 fan-out 失控）；澄清不可自答；Cowork + 每个子代理调用计入配额与审计。
- **DoD**：单测：子代理的 high_write 被拒；超子代理上限被钳制；后台 Cowork 的子代理只读/按白名单；配额超限的 Cowork 被拒；审计含每个子代理调用。
- **依赖**：S6-T3、Sprint 04/05 安全。

---

## 里程碑 E — 质量闸门

### S6-T8 · Eval 扩展（Cowork）
- **做**：扩 `evals/`：①Plugin 安装 → 其 skills 可 match/run ②子代理 fan-out 完成 + 数量上限钳制 ③澄清门控（后台返回 null、不自答）④Cowork 端到端（规划→子代理→汇总）⑤安全继承（子代理 high_write 拒 / 后台只读）+ 审计含子代理。CI 用 stub（确定性、离线）。
- **DoD**：`pnpm eval` 覆盖以上；CI 必过；故意破坏（plugin 未生效 / fan-out 不封顶 / 澄清自答 / 子代理越权）任一即变红。
- **依赖**：S6-T1…T7。

### S6-T9 · 文档回写 + Demo 升级
- **做**：更新 README/ARCHITECTURE/CLAUDE/AGENTS（Plugin/子代理/Cowork/澄清命令与模型）。Demo 端到端走通（离线可演示），Sprint 06 DoD 勾选。
- **DoD**：新人/新代理按 README 一条命令起本地；命令与实际一致；Demo 端到端可演示。
- **依赖**：S6-T1…T8。

---

## 执行顺序与并行建议

```
S6-T1(Plugin 注册) ─ S6-T2(官方包)
S6-T3(子代理编排) ─ S6-T4(Cowork 编排) ─┬─ S6-T5(澄清)
                                          ├─ S6-T7(安全/配额)
                                          └─ S6-T6(Cowork UI)
                              全部收口 → S6-T8(Eval) → S6-T9(Docs/Demo)
```
- **关键路径**：S6-T1（Plugins）与 S6-T3（子代理）是两条地基；S6-T4（Cowork 编排）汇聚二者。
- **可并行**：Plugins 线（T1-T2）与子代理线（T3）并行；T4 后澄清（T5）、安全（T7）、UI（T6）并行。
- **每完成一个任务**：跑该模块单测 + 相关 eval；一任务一 PR，CI 绿即合；提交说明写清「动了哪个注册点 + 加了哪个 eval」。

## Sprint 06 Definition of Done（整体验收）
- [ ] Plugins：声明式 Plugin 可安装/卸载，安装后其 skills 可 match/run；所需连接器标注；按 owner 隔离、持久化。
- [ ] 官方包：一键安装官方 Plugin，新增官方包无需改业务代码。
- [ ] 子代理：Coordinator 并行 fan-out + 汇总；并发与总量有上限；事件可回放；每个子代理审计。
- [ ] Cowork：装 Plugin → Cowork 目标 → 规划 subgoals → 子代理并行 → 汇总交付；可作为后台/定时 Job。
- [ ] 澄清：前台可问可答续跑；后台返回 null、安全降级、绝不自答。
- [ ] 安全：子代理继承 Safety 三级 + 后台规则；high_write 永拒；配额计入 Cowork + 子代理。
- [ ] `pnpm eval` 含 Plugin 生效 / fan-out 封顶 / 澄清门控 / Cowork 端到端 / 安全继承；CI 全门禁绿。
- [ ] 持久化：已安装 Plugin / Cowork Job 重启后仍在（Postgres）。
- [ ] README/命令/架构文档一致更新；Demo 端到端走通（离线可演示）。

## 风险与提示（给代理）
- **fan-out 必须封顶**：子代理并发 + 总量硬上限（防一个 Cowork 目标炸出无限子代理）；超限钳制并 log，不静默无界。
- **澄清绝不自答**：clarify 是人类动作；后台无人 → 返回 null → 安全降级（默认/标注），不得让模型自答自走。
- **子代理继承全部安全**：每个子代理就是一次受 Safety 三级 + 后台 approve 策略约束的 agent 运行；high_write 永拒；调用落审计。
- **Plugin 只是打包**：Plugin = 已有 skills/连接器/子代理的角色化捆绑，不引入新执行通道；安装即把声明式资源并入该 owner。
- **复用 Sprint 05**：Cowork 作为 Job 跑——前台 SSE、后台/定时复用 JobRunner/Scheduler/通知/配额，不另造运行时。
- **桌面文件区不做**：本 Sprint 工作区 = 项目/对象存储；真实本地目录读写留待 Sprint 07（高信任成本）。
- **不确定/不可逆**（subgoal 规划粒度、并发上限默认、命令别名语义）→ 选保守默认并在 PR 标注。
