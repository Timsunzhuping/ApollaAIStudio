# Apolla AI — 开发计划

> 版本：v1.0　|　最后更新：2026-06-06　|　配套：[PRD](./PRD.md) · [仓库指南](../CLAUDE.md)
>
> 本文档面向工程执行，可直接驱动 Claude Code 分阶段、分任务开发。每个阶段给出**目标、交付物、技术任务、验收口径**。

---

## 1. 总体节奏

24 周标准交付节奏，分六阶段。核心原则：**MVP 先打通"研究到成品"，V1 再做"执行与自动化"。**

| 阶段 | 周次 | 里程碑 | 验收口径 |
|---|---|---|---|
| 0 发现与架构 | W1–W4 | **架构冻结** | 模型路由、Prompt Registry、任务对象、数据模型、埋点方案确定；开放问题闭环 |
| 1 基础平台 | W5–W10 | 平台底座可用 | 账号/计费/项目空间 + 模型抽象层 + RAG/文件管线跑通 |
| 2 MVP 功能 | W7–W14 | **MVP Alpha** | 能完成"输入资料 → 研究 → 报告/Slides/Artifact 导出"全链路 |
| 3 Beta 硬化 | W14–W18 | **私测 Beta** | 100–300 名设计伙伴稳定使用；引用/导出/计费完整 |
| 4 V1 功能 | W18–W22 | Public Beta | 侧边栏 + 项目空间 + 基础记忆 + 成本面板可商用测试 |
| 5 发布 | W22–W24 | **GA** | D7/任务完成率/成本占比达标；客服/风控/内容政策就绪 |

> 阶段存在时间重叠（如基础平台与 MVP 功能并行），符合甘特图节奏。

---

## 2. 技术栈与架构原则

**MVP 不过度微服务。** 推荐栈：

```
前端触点层：Next.js + TypeScript（Web App 主阵地）
            Browser Extension（增长入口，Manifest V3）
            Desktop Shell（v1 后用轻壳复用 Web）
产品中台层：TypeScript BFF / API Gateway
            Auth / Billing / Usage Ledger
            Conversation · Project/Memory · Artifact/Export · Search/RAG
智能编排层：Model Router · Prompt Registry · Tool Runtime
            Media Generation Service（图像/视频，Media Adapter 层）
            Workflow/Task Orchestrator · Safety & Policy Engine
            （Python AI Workers）
基础设施层：Postgres · Redis（缓存/队列）· S3/OSS（对象存储）
            pgvector / Qdrant（向量检索）· 观测与分析
```

**铁律**：
1. **不在业务逻辑里硬编码具体模型名**。模型只通过逻辑别名（`gpt_fast` / `gpt_premium` / `claude_write` / `claude_premium`）访问，由路由配置中心按延迟/成本/成功率/用户档位/任务类型动态映射。
2. **Prompt 不散落代码里**。所有 Prompt 进 Prompt Registry，带版本号、Schema、评测集、灰度开关、回滚版本。
3. **每次任务都是任务对象**：可观察、可计费、可回放、可归档。
4. **默认结构化输出**（Structured Outputs / JSON Schema）。
5. **真正复杂的是智能编排，不是 CRUD。**
6. **外部内容默认不可信**：网页、上传文件、工具/MCP 输出走"数据"通道而非"指令"通道；由不可信内容触发的动作强制确认并默认只读（防 prompt 注入，PRD §12.E）。
7. **工具走标准而非 bespoke**：外部工具/数据源优先用 MCP 接入；Tool Runtime 架构期即预留 MCP 抽象（PRD §12.C）。
8. **Skill = 声明式 Markdown 文件**：兼容 agentskills.io 开放标准，与 Prompt Registry 同源版本化（PRD §12.A）。
9. **可执行工具一律进沙箱**：代码执行 / Artifact 运行 / 浏览器动作运行于容器隔离 + 每任务工具 allowlist（PRD §12.D）。
10. **媒体生成走统一 Media Adapter**：图像/视频模型用逻辑别名（`image_fast`/`image_premium`/`video_standard`/`video_premium`）+ provider 适配器，配置即换模型，禁止硬编码媒体模型名；视频一律异步任务对象 + 成本预估 + 内容审核（PRD §13）。

---

## 3. 阶段详解与任务分解

### 阶段 0：发现与架构（W1–W4）

**目标**：冻结架构与数据模型，闭环开放问题。

任务：
- [ ] 闭环 PRD 开放问题：首发市场区域、定价 benchmark、高阶模型预算上限。
- [ ] 定义**任务对象（Task）数据模型**：状态机（plan → search → extract → compare → generate → deliver）、可回放、可计费字段。
- [ ] 定义核心数据模型：User、Project、Conversation、Message、Artifact、Source/Citation、UsageLedger、PromptVersion。
- [ ] 设计**模型路由配置 schema**与四别名映射表。
- [ ] 设计 **Prompt Registry schema**：`prompt_id`、版本号、场景、I/O Schema、安全约束、评测集、灰度开关、回滚版本。
- [ ] 设计埋点方案（对齐 PRD KPI 全部指标）。
- [ ] 搭建 monorepo 骨架、CI/CD 流水线、环境（dev/staging/prod）。

**验收（架构冻结）**：上述 schema 与方案评审通过，CI 跑通空骨架。

---

### 阶段 1：基础平台（W5–W10）

**目标**：账号/计费/项目空间 + 模型抽象层 + RAG/文件管线。

#### 1A 产品中台
- [ ] Auth（注册/登录/会话）。
- [ ] Billing 与配额：Freemium/Pro/Power 三档；UsageLedger 记录每任务 token/成本。
- [ ] Project/Memory Service：项目空间、上下文继承、素材库。
- [ ] Conversation Service：消息持久化、流式。

#### 1B 智能编排层
- [ ] **Model Router**：四别名 + OpenAI Adapter + Anthropic Adapter；失败降级（高阶失败 → 轻量 + 缩上下文 + 只读）。
- [ ] **Prompt Registry**：版本化存取、灰度、回滚。
- [ ] **Tool Runtime**：工具注册/调用框架（Web Search、File Parser、Export 先接入）。
- [ ] **Safety & Policy Engine**：自动化三级权限判定（只读/低风险/高风险）。

#### 1C RAG/文件管线
- [ ] 文件解析 + OCR（PDF/Doc/网页/图片）。
- [ ] 切分 + 嵌入 + 向量入库（pgvector/Qdrant）。
- [ ] 检索 + rerank；**检索层缓存**（chunk/embedding/rerank 复用）。

**缓存三层全部就位**：
1. Provider Prompt Caching（吃满 OpenAI/Anthropic 自动缓存）。
2. 应用层结果缓存（FAQ/模板抽取/网页摘要短 TTL 语义缓存；Artifact 中间结果可恢复缓存）。
3. 检索层缓存。

**验收**：能用任一别名完成一次带工具调用的结构化输出任务，成本写入 UsageLedger。

---

### 阶段 2：MVP 功能（W7–W14）

**目标**：打通三条核心用户流的第一条 + 侧边栏。

- [ ] **统一聊天**：Auto/GPT/Claude 模式切换，流式输出。
- [ ] **Web Research 工作流**：问题拆解 → 搜索抓取 → 证据视图（来源列表+引用片段+观点对比）→ 异步任务对象（计划草图+阶段进度+预估耗时）。
- [ ] **文件理解**：上传 + 多轮问答，结果进素材库。
- [ ] **Artifact 生成**：网页/交互 demo/小工具，可预览可编辑。
- [ ] **Docs/Slides 导出**：Doc/PDF/PPT/网页一键导出，保留引用。
- [ ] **浏览器侧边栏 MVP**：当前页总结/翻译/抽取/比对/保存到项目/生成报告（仅只读 + 低风险辅助）。
- [ ] **反馈与评测**：点赞/点踩/纠错，回流 golden set。
- [ ] **成本面板**：任务级成本提示，高成本任务显式标识。

**验收（MVP Alpha，W10–W12）**：完整跑通"输入资料 → 研究 → 报告/Slides/Artifact 导出"。

---

### 阶段 3：Beta 硬化（W14–W18）

**目标**：质量、安全、可靠性达私测标准。

- [ ] **Prompt 回归 / LLM Eval** 套件（见第 5 节）。
- [ ] **安全策略**落地：数据隔离/删除/导出、关闭记忆、关闭训练共享（用户可见设置）。
- [ ] 引用正确性、导出稳定性、计费准确性打磨。
- [ ] 私测用户接入（100–300 名，覆盖内容/研究/求职/产品开发四类）+ 问题修复。

**验收（私测 Beta）**：设计伙伴可稳定使用；引用/导出/计费完整。

---

### 阶段 4：V1 功能（W18–W22）

**目标**：执行与个人化闭环（P1）。

- [ ] **Memory Lite**：用户偏好/写作风格/项目习惯记忆。
- [ ] **Custom Skills**：模板化工作流与自定义 Agent。
- [ ] **低风险 Browser Actions**：只读 + 低风险辅助写入（动作前预览+确认，失败切只读）。
- [ ] **Scheduled Tasks**：定时周报/日报/提醒/监控。
- [ ] **Share & Publish**：分享链接、公开网页、模板市场。
- [ ] **多媒体生成（文生图/文生视频）**（PRD §13）：
  - [ ] Media Generation Service + 统一 `MediaAdapter` 接口（submit/poll/fetchResult/capabilities/estimateCost/mapError）。
  - [ ] 媒体逻辑别名与路由配置（`image_*` / `video_*`），与 LLM 路由同构。
  - [ ] 接入 ≥1 个图像 provider（文生图/图生图）。
  - [ ] 接入 **Seedance 2.0** 视频适配器（文生视频/图生视频/参考图/运镜/时长/分辨率），异步任务 + 回调。
  - [ ] 媒体成本预估 + UsageLedger 记账 + 高成本任务二次确认。
  - [ ] 生成前后内容审核（NSFW/版权/肖像）接入 Safety & Policy Engine。
  - [ ] 产物落 Artifact/素材库，支持预览/改参重生成/导出/分享/存为 Skill 模板。
- [ ] （可选）Voice Input。
- [ ] **Monica / Genspark 能力补全**（PRD §14，复用统一底座，分批上线）：
  - [ ] 翻译模块（侧边栏即时 + 文档级双语对照 + 术语/风格保持）。
  - [ ] 写作工作台 Writer（模板化长文/改写/口吻，复用声明式 Skill）。
  - [ ] AI Sheets（NL 生成/清洗/透视/可视化，导出 xlsx/csv，结构化抽取走 gpt_premium）。
  - [ ] AI Meeting Notes（ASR 转写 + 说话人分离 + 纪要/行动项，行动项可转 Scheduled Tasks）。
  - [ ] AI Developer（Artifact 进阶为多文件可运行应用，运行于沙箱）。

**验收（Public Beta）**：侧边栏 + 项目空间 + 基础记忆 + 成本面板可商用测试。

---

### 阶段 5：发布（W22–W24）

- [ ] 公测 / 增长实验 / 订阅优化。
- [ ] 客服 / 风控 / 内容政策就绪。
- [ ] GA 冻结与发布。

**验收（GA）**：D7 ≥ 20%、任务完成率 ≥ 75%、模型成本占收入比 ≤ 35%（详见 PRD KPI）。

---

### 3.7 借鉴 OpenClaw / Hermes Agent 的技术增强（按阶段分布）

详见 [PRD §12](./PRD.md#12-技术能力增强借鉴-openclaw-与-hermes-agent)。以下把借鉴能力落到对应阶段的可交付 checklist。

**阶段 0（架构期）**
- [ ] 定义**声明式 Skill/Agent 文件 schema**（frontmatter：名称/触发场景/所需工具/I/O Schema/安全级别/Prompt 版本），兼容 agentskills.io；与 Prompt Registry 同源（PRD §12.A）。
- [ ] **Tool Runtime 预留 MCP 抽象**：工具/数据源以 MCP 为统一接入标准（PRD §12.C）。
- [ ] 设计**沙箱运行时**接口：Docker 后端 + 每任务工具 allowlist/denylist；预留 serverless（Modal/Daytona 式）后端（PRD §12.D）。
- [ ] 设计**不可信输入策略**：数据/指令通道分离、动作门控、来源不可信标注（PRD §12.E）。
- [ ] Model Router 设计纳入**显式 failover 链 + 多密钥轮换**（PRD §12.H）。
- [ ] 设计**媒体生成适配层**：`MediaAdapter` 接口 + 媒体逻辑别名 + 能力矩阵/成本预估字段，与 LLM 路由配置同构（PRD §13.2）。预留 Seedance 2.0 等视频 provider 的异步/回调接入形态。

**阶段 1（基础平台）**
- [ ] 实现沙箱运行时（Docker + 工具白名单），接入代码执行 / 工具调用。
- [ ] 实现 Model Router failover 链与多密钥轮换。
- [ ] Safety & Policy Engine 落地不可信输入隔离（数据通道）。
- [ ] Tool Runtime 落地基础 MCP 客户端骨架（内部工具先以 MCP 形态注册）。

**阶段 2（MVP）— P0**
- [ ] **不可信输入防护上线**：网页/文件/侧边栏摄入内容全部走数据通道；动作门控 + 来源标注（PRD §12.E）。
- [ ] **上下文压缩**（/compact 等价）：长 Research / 长会话超阈值自动+手动压缩（PRD §12.F）。
- [ ] Artifact 运行于沙箱。

**阶段 4（V1）— P1**
- [ ] **闭环自动写 Skill**：高质量任务收尾后自动起草可复用 Skill，用户一键审阅保存（PRD §12.A）。
- [ ] **持久记忆架构**：FTS 会话检索 + LLM 摘要 + 结构化用户模型 + memory nudging（PRD §12.B）。
- [ ] **交互式 Artifact（A2UI）**：agent 可渲染组件、捕获输入、按输入更新（PRD §12.G）。
- [ ] **serverless 休眠** Worker / Artifact 运行环境（成本，PRD §12.D）。
- [ ] **基础 MCP 客户端**面向 power user 接入外部 MCP server（PRD §12.C）。
- [ ] 完整 slash 指令集（/think、/usage、/new、/reset 等，PRD §12.F）。
- [ ] 低风险 Browser Actions 运行于浏览器动作沙箱。

**阶段 v2（P2）**
- [ ] MCP 连接器市场（Notion/Drive/Gmail/Calendar 等以 MCP 接入，PRD §12.C）。
- [ ] OAuth 订阅额度接入（BYOK，PRD §12.H）。
- [ ] 可视化 Workflows（拖拽 DAG 编排，节点=工具/模型/条件/人工确认，PRD §14.2）。
- [ ] 多端：移动 App + IDE 插件（VSCode/JetBrains），薄客户端复用中台（PRD §14.2）。
- [ ] 语音对话/通话（TTS/ASR 统一适配层，PRD §14.2）。
- [ ] Open API 开发者平台（对外研究/生成/导出 API + 用量计费，PRD §14.2）。
- [ ] 团队治理与企业能力（SSO/SAML、管理台、训练退出、成员内容隔离、审计、DPA/VPC，PRD §14.3）。
- [ ] **Cowork 模式（旗舰整合，PRD §15）**：
  - [ ] Plugins 打包机制（Skills+连接器+slash 命令+子代理 的角色化捆绑，官方包 + 自建）。
  - [ ] 子代理编排（派生/并行/汇总）。
  - [ ] 桌面文件工作区（授权目录读写，作为任务工作区）。
  - [ ] 主动澄清机制（不确定/不可逆动作前提问）。
  - [ ] 后台自治运行 + 完成通知（复用任务对象 + 定时/后台）。
  - [ ] 企业管控：RBAC、组织/组花费上限、用量分析、OpenTelemetry、按工具连接器开关。
  - [ ] 前置依赖：沙箱（MVP）、MCP 连接器（v1/v2）、Skills（v1）、记忆（v1）、Browser Actions（v1）须先就绪。

> **新增 LLM/安全测试项**：prompt 注入对抗用例（不可信内容尝试诱导越权动作）、沙箱逃逸检查、Skill 自动生成质量回归、记忆召回正确性。
>
> **媒体生成测试项**（PRD §13）：MediaAdapter provider contract test（新增/替换 provider 不破坏调用方）、成本预估准确性回归、内容审核（NSFW/版权/肖像）拦截用例、视频异步任务失败回退、能力矩阵一致性。

---

## 4. CI/CD

**主干开发 + 功能开关 + 每周发布列车。**

每次 PR 至少过：
- Type Check · Lint · Unit Test · Schema Test · **Prompt 校验** · **Provider Contract Test**。

合并到主干 → 自动部署 Staging → 跑固定 LLM Evals（研究任务、抽取任务、导出任务、失败回退、工具调用成功率）。

---

## 5. 测试策略（关键：传统测试 + LLM 产品测试）

传统前后端测试之外，**必须加一层 LLM 产品测试**：

1. **Golden set 回归**：同类任务在新 Prompt/新模型下是否退化。
2. **Citation correctness**：引用来源是否对应。
3. **Cost regression**：同一任务成本是否异常上升。
4. **Tool success regression**：浏览器/抽取动作是否因页面结构变化失效。

---

## 6. 监控（四块看板）

| 看板 | 内容 |
|---|---|
| 业务 | 激活、留存、导出、付费转化 |
| 质量 | 任务完成率、引用率、用户反馈 |
| 成本 | 模型成本、工具调用成本、单位用户毛利 |
| 技术 | p95 延迟、provider error rate、cache hit rate、queue latency |

> **没有成本与质量看板的 Agent 产品，容易在"看起来很酷"阶段死于单位经济失控。**

---

## 7. 团队配置

| 角色 | 人数 | 职责 |
|---|---:|---|
| 产品经理 | 1 | PRD、优先级、商业化、实验框架 |
| 设计师 | 1 | IA、工作台、侧边栏、导出体验 |
| 前端工程师 | 2 | Web App、Extension、工作区与导出 UI |
| 后端工程师 | 2 | BFF、Auth/Billing、Projects、Artifacts、RAG |
| AI/平台工程师 | 2 | Router、Prompt Registry、Tool Runtime、Evals |
| 测试/质量 | 1 | UI 自动化、回归、LLM eval、灰度验收 |
| DevOps/Infra | 0.5–1 | CI/CD、观测、成本、环境治理 |

> **Prompt/Eval/Router 必须有人专职**，否则"多模型产品"会退化成"若干硬编码 prompt 的合集"。

---

## 8. 预算区间（中国团队视角，首 6 个月研发投入，不含品牌投放）

| 方案 | 团队 | 周期 | 人力成本 | 云与模型成本 | 合计 |
|---|---:|---:|---:|---:|---:|
| 精简版 MVP | 7–8 人 | 5–6 月 | 220–360 万 RMB | 40–100 万 RMB | 260–460 万 RMB |
| 标准版 Beta/GA | 9–11 人 | 6–7 月 | 360–620 万 RMB | 80–180 万 RMB | 440–800 万 RMB |

模型/云成本主要受四因素影响：Research/长文占比、是否强依赖高阶模型、导出与自动化是否高频、缓存与批处理是否吃满。

**成本控制策略**：70%+ 请求路由到中低成本模型，高阶模型集中在少数高价值环节，充分用 Prompt Caching + Batch（输入输出各 50% 折扣）。

---

## 9. 上线策略与风险

**三阶段上线**：设计伙伴内测（100–300 人）→ 邀请制公测（侧边栏+模板为传播抓手）→ 正式 GA（留存/成本/安全达标后放量）。

**主要风险与缓解**：

| 风险 | 表现 | 缓解 |
|---|---|---|
| 同质化 | 又一个"多模型聊天工具" | "来源透明+成品交付+项目复用+低风险执行"独特闭环 |
| 模型成本失控 | Research/Artifact/长文毛利差 | 强制路由、缓存、上下文压缩、异步批处理、成本看板、按任务计费提示 |
| 自动化出错 | 表单误填、页面变更、投诉 | 首版只做低风险动作；动作前预览确认；失败切只读 |
| 用户不信任 | 担心文件/账号/隐私泄露 | 默认不训练共享、显式删除/导出、权限分级、本地浏览器辅助优先 |
| 结果不可靠 | 幻觉、引文错配、风格不稳 | 默认引用、结构化输出、评测集回归、反馈闭环 |
| 产品过宽 | 被拖入"做全家桶" | 严格约束首发闭环，只保留高频高感知功能 |
| 商业化心智复杂 | credits/订阅/用量讲不清 | "订阅包 + 任务用量提示 + 高成本任务额外标识"混合设计 |

---

## 10. 给 Claude Code 的执行建议

1. **先读** [PRD.md](./PRD.md) 与 [CLAUDE.md](../CLAUDE.md) 再动手。
2. **按阶段推进**，不要跳过阶段 0 的架构冻结直接写功能。
3. **每个功能从数据模型与 Schema 开始**，再写编排，最后写 UI。
4. **新增模型调用必经 Model Router 与 Prompt Registry**，禁止硬编码模型名与内联 Prompt。
5. **每个 P0 功能落地时同步写 LLM eval golden case。**
6. **任务拆分粒度**：以本文档的 `[ ]` checklist 项为最小可交付单元，逐项实现并自测。
