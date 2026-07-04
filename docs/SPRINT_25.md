# Sprint 25 — 可信研究攻坚：抓取 → 抽取验真 → 比对 + Live Eval 门禁

上位文档：PRD §6.2（可信研究）、§12.E（不可信输入防护）| PR：#137（抓取）、#138（验真/比对 + live eval）

**目标**：研究管线从「搜索摘要 → 综合」升级为「搜索 → 抓取原文 → 逐字引文验真 → 跨源比对 → 脚注引用成稿」。
引用正确性从"信任模型"变成"机器验证"。

## 交付

| 任务 | 内容 | 位置 |
|---|---|---|
| T1 契约 | `Snippet`、`Citation.snippetIds/status`、`Source.degraded`、`Task.snippets`（全部向后兼容） | `packages/contracts/src/task.ts` |
| T2 抓取 | `web_fetch` 工具（SSRF 防护 + 段落级 untrusted 分块）；`HttpFetchProvider`（readability-lite，`FETCH_MODE=http` 启用）/ `StubFetchProvider`（确定性 + 注入 fixture） | `harness-core/src/tools/fetch*` |
| T3 抽取验真 | EXTRACT 阶段真实化：按子问题 LLM 选段 → **程序化验真**（引文必须是原文逐字子串，伪造即弃） | `orchestrator/verify.ts` + `research.ts` |
| T4 比对 | COMPARE 阶段：跨源 claims，状态从证据**重算**（反证→disputed；≥2 页面→corroborated）；报告新增 Key claims / Cited snippets（`[^snippetId]` 脚注）/ 降级来源标注 | 同上 |
| T5 门禁 | `pnpm eval:live`：真实 key 跑 10 题 golden，度量覆盖率（≥80%）/降级率/成本（≤$0.6/题）；报告落 `evals/live/reports/` | `evals/live/` |
| T6 对抗 | 注入 fixture（页面内指令只进数据通道、绝不成为动作）+ 验真拒伪测试 | `tools/fetch.test.ts`、`orchestrator/verify.test.ts` |
| T7 文档 | 本文件 | — |

## 安全与兼容设计

- **门控启用**：verified 路径仅当「真实抓取发生 + 新 prompts 已注册」，否则走原路径——旧部署/evals 零行为变化。
- **引用不变量**：citations 的 sourceIds 恒映射回展示来源（chunk→请求 origin→search hit），
  `citation-correctness` eval 不变量保持成立。
- **降级**：抓取失败 → 源标记 `degraded` 回退搜索摘要，管线绝不因抓取中断。
- **防注入**：抓取内容一律 untrusted、只进数据通道；demo 适配器对新阶段确定性响应（离线 e2e 跑通完整 verified 管线）。

## 部署

合并后 ECS `.env` 加 `FETCH_MODE=http` → `./deploy.sh`。验收：线上跑一题研究，
报告出现「Cited snippets」脚注区且引文可对回原文；随后在带 key 环境跑 `pnpm eval:live` 归档首份报告。
