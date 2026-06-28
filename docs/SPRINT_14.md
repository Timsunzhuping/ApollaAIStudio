# Sprint 14 执行单 — Identity & Onboarding：可插拔 OAuth/SSO 登录

> 读者：**Codex / Claude Code**。逐任务从上往下执行；每个任务自带验收（DoD）、依赖、改动位置。
> 前置必读：[ARCHITECTURE.md](./ARCHITECTURE.md) §1（公理③升级即换挡 / 适配器模式）· [AGENTS.md](../AGENTS.md)（安全周界 S10）· `apps/bff/src/auth.ts`（`startSession`/`readSession`/签名 httpOnly 会话已就绪）· `packages/harness-core/src/repo/`（`UserRepository.upsertByEmail` 已按 email 去重）· Sprint 10（鉴权/限流/安全）· Sprint 13（计费，已完成）。
> 目标产物（Sprint Demo）：**点「用 Google / GitHub 继续」→（Stub provider 离线模拟）授权 → 回调建/连账号 → 签发会话 → 进入工作台；同邮箱的密码账号与 OAuth 身份自动归一为一个用户。** 身份 Provider 可热插拔（Stub 离线 / Google + GitHub 生产），全程 CSRF/开放重定向安全，OAuth token 不落库/不入日志。

## 0. Sprint 范围与非目标

**主题**：S13 刚把产品做成了生意（套餐/订阅/计费）。变现漏斗是 **落地 → 注册 → 订阅 → 使用**——我们有了「订阅」和「使用」，但「注册」still 只有邮箱+密码，**摩擦最高的一环**。本 Sprint 用 harness 的招牌动作——**可插拔 capability provider**——把"身份"也做成可换挡适配器：`AuthProvider`（OAuth 2.0 / OIDC）适配器（**Stub 离线 / Google + GitHub 生产**，fetch-based、无 SDK、env 门控，与 LLM/媒体/搜索/支付适配器同构），账号按邮箱归一（密码 + 多个 OAuth 身份同属一个用户），复用既有签名会话签发。这是"升级即换挡"公理在**身份**上的应用，直接喂给 S13 的变现漏斗。

**做（本 Sprint 的闭环）**
- 身份 Provider：`AuthProvider` 接口（authorizeUrl(state,pkce) / exchangeCode→tokens / fetchIdentity→{providerId,email,emailVerified}）+ `StubOAuthProvider`（离线确定性，全流程内存模拟）+ `GoogleOAuthProvider` / `GitHubOAuthProvider`（fetch-based、env 门控、缺 key 不注册）。`OAuthIdentity` 契约 + `IdentityRepository`（内存 + Postgres）。
- OAuth 流程（BFF）：`GET /api/auth/oauth/:provider/start`（生成 **state + PKCE**、存单次态、302 到授权 URL）；`GET /api/auth/oauth/:provider/callback`（**验 state** → 换 code → 取 identity → 按 email upsert/link 用户 → `startSession` 签发会话 → 302 回应用）。
- 账号归一：OAuth 身份 link 到同邮箱既有用户，或新建；一个用户可有密码 + 多个 OAuth 身份；`GET /api/auth/me` 显示已连身份。安全：state 单次 + 过期 + 绑定、**开放重定向防护**（回跳只允许 allowlist 应用源）、email 未验证处理。
- UI 与交付：登录/注册页加「用 Google / GitHub 继续」；OAuth 回跳落地；设置页「已连账号」视图。
- 身份安全与完整性：state/PKCE 单次 + 过期 + CSRF 安全；回跳开放重定向 allowlist；**OAuth token 不落库**（只存 providerId + email；如必须存则 `SECRETS_KEY` 加密），不入日志/响应；按**已验证邮箱**归一，邮箱不符 fail-closed；身份 link/login 落审计；demo 用 Stub、生产 env 门控真 provider，demo 不削弱生产默认。
- 质量闸门：stub 全流程（start→callback→session）/ 账号归一（既有 email→link、新→create、多身份）/ state CSRF（伪造/过期/重放拒）/ 开放重定向拒 / Web UI；文档/Demo。

**不做（留待 Sprint 15+）**
- 完整 OIDC discovery / JWKS 轮换深度、SAML / 企业 SSO、目录同步（SCIM）。
- MFA / TOTP / passwordless 魔法链接 / 短信验证码。
- 浏览器扩展的 OAuth（扩展继续用 API token，本 Sprint 明确不动）。
- refresh-token 长期存储 / 轮换、社交资料深度同步（仅取 email + providerId）。
- **Playwright e2e**（仍是独立质量 Sprint）；真实 Stripe 生产硬化（独立 Sprint）。

**全程铁律**（违反即返工，见 [AGENTS.md](../AGENTS.md)）：**OAuth state CSRF 安全**（单次、过期、与 PKCE/会话绑定）；**回跳只允许 allowlist 应用源**（杜绝开放重定向）；provider 返回的数据是 untrusted（不当指令、按已验证 email 归一）；**OAuth token 不落库**（只存 providerId + email；必须存则 `SECRETS_KEY` 加密），绝不入日志/响应；账号归一按**已验证邮箱**，不符 fail-closed；会话签发**复用** `startSession`（签名 httpOnly + 过期 + 登出失效），不另造会话机制；demo 用 Stub、真 provider env 门控，**demo 不削弱生产**；身份 Provider 是可换挡适配器（Stub 离线 / Google+GitHub env 门控），缺 key 不注册；身份 link/login 落审计；改动集中在 `contracts`/`harness-core`(auth)/`adapters`(auth-oauth)/`apps`/`evals`；每个能力配测试。

---

## 里程碑 A — AuthProvider 适配器 + OAuth 核心

### S14-T1 · AuthProvider 接口 + StubOAuthProvider + 身份契约
- **做**：`contracts` 加 `OAuthIdentity`（userId/provider/providerId/email/createdAt）。`harness-core/src/auth/oauth.ts`：`AuthProvider` 接口（`authorizeUrl({state, pkceChallenge, redirectUri})` / `exchangeCode({code, pkceVerifier, redirectUri}): Promise<tokens>` / `fetchIdentity(tokens): Promise<{providerId, email, emailVerified}>`）+ `StubOAuthProvider`（离线确定性：authorizeUrl 返回本地链接含 state、exchange/fetchIdentity 由 code 内联出确定 identity）。`IdentityRepository`（内存：按 provider+providerId 查、link、list by userId）。`OAuthStateStore`（内存：put/consume 单次 + 过期）。
- **DoD**：Stub：authorizeUrl→（模拟）回 code→exchange→fetchIdentity 得 {providerId,email}；state put→consume 一次成功、二次/过期失败。单测覆盖 stub 全流程 + state 单次/过期。
- **改动**：`contracts/src/identity.ts`、`harness-core/src/auth/oauth.ts`、`harness-core/src/auth/identity-repo.ts`、`db-postgres`（oauth_identities 表 + auth_states 可选）。
- **依赖**：S10 会话、`UserRepository.upsertByEmail`。

### S14-T2 · Google + GitHub provider（env 门控）
- **做**：`adapters/auth/oauth`：`GoogleOAuthProvider` / `GitHubOAuthProvider`（fetch-based、无 SDK；authorize/token/userinfo 端点；`GOOGLE_CLIENT_ID/SECRET`、`GITHUB_CLIENT_ID/SECRET` 从 env；缺 key 不注册该 provider）。注册表 `buildAuthProviders()`：Stub 始终在（离线默认）；真 provider 按 env 加入。
- **DoD**：缺 env → 只有 stub；配 env → google/github 注册。provider 的 authorizeUrl/exchange/fetchIdentity 形状与 stub 一致（契约测试用 mock fetch 验 Google/GitHub 的 userinfo 映射 → {providerId,email,emailVerified}）。
- **依赖**：S14-T1。

---

## 里程碑 B — OAuth 流程 + 账号归一（BFF）

### S14-T3 · OAuth start + callback 端点
- **做**：BFF —— `GET /api/auth/oauth/:provider/start`：校验 provider 已注册 → 生成 state + PKCE（challenge/verifier）→ 存单次态（绑 verifier + 过期）→ 302 到 `authorizeUrl`。`GET /api/auth/oauth/:provider/callback?code&state`：**consume state**（失败 400/401）→ `exchangeCode` → `fetchIdentity` → 按 email 归一（见 T4）→ `startSession` 签发会话 → **302 回 allowlist 应用源**。错误/未注册 provider → 安全报错。
- **DoD**：stub 走通 start→callback→拿到会话 cookie→`/api/auth/me` 200；伪造/缺失/重放 state → 拒；回跳目标只允许 allowlist。
- **依赖**：S14-T1/T2、S10（`startSession`/限流/审计）。

### S14-T4 · 账号归一 + 多身份
- **做**：归一逻辑：`fetchIdentity` 得 email（要求 emailVerified，否则 fail-closed 拒）→ `IdentityRepository` 按 provider+providerId 查：命中 → 该 userId；未命中 → `UserRepository.upsertByEmail(email)` 得/建用户 → link 新身份。一个用户可密码 + 多 OAuth 身份。`GET /api/auth/me` 返回 `identities: [{provider}]`。身份 link/login 落审计。
- **DoD**：新邮箱 OAuth → 建用户 + 身份；已有密码账号同邮箱再用 OAuth → link 到同一 userId（不重复建号）；同一身份二次登录 → 同 userId；`me` 列出已连 provider；emailVerified=false → 拒。
- **依赖**：S14-T3、`UserRepository`。

---

## 里程碑 C — UI 与身份安全

### S14-T5 · 登录/注册 UI + 已连账号
- **做**：`apps/web` 登录/注册页加「用 Google 继续 / 用 GitHub 继续」（指向 `/api/auth/oauth/:provider/start`，仅展示已注册 provider）；OAuth 回跳后落地到工作台；设置页「已连账号」列出 `me.identities`。仅展示后端实际注册的 provider（health/能力探针式）。
- **DoD**：浏览器：点按钮 →（stub）走通 → 已登录进工作台；设置页显示已连 provider；无配置时不显示按钮；组件测试覆盖按钮渲染/回跳处理（mock）。
- **依赖**：S14-T3、S9 前端。

### S14-T6 · 身份安全与完整性
- **做**：state **单次 + 过期 + 与 PKCE 绑定**；callback **开放重定向防护**（回跳 URL 只允许 allowlist 应用源，默认本应用）；**OAuth token 不落库**（只存 providerId+email；如需存 `SECRETS_KEY` 加密）、不入日志/响应；归一按 emailVerified、不符 fail-closed；provider 数据 untrusted；身份 link/login 落审计；demo 用 stub、真 provider env 门控（不削弱生产）。
- **DoD**：单测：伪造/过期/重放 state 拒；非 allowlist 回跳拒；日志/响应/`me` 不含 OAuth token；emailVerified=false 拒；跨 provider 同邮箱归一正确且不串号；审计有 link/login 记录。
- **依赖**：S14-T1、S14-T3、S10 安全。

---

## 里程碑 D — 质量闸门

### S14-T7 · Eval/测试扩展
- **做**：stub 全流程 start→callback→session 端到端（HTTP 集成，复用 `{handle,setHarness}` 模式）；账号归一（新建/link/多身份/二次登录）；state CSRF（伪造/过期/重放）；开放重定向拒；emailVerified fail-closed；Google/GitHub userinfo 映射（mock fetch）；Web UI 组件测试。可加 1 项 eval：身份归一（多 provider 同邮箱 → 单用户）。CI 离线确定性（stub provider）。
- **DoD**：`pnpm test` + `pnpm test:web`（+ 如加则 `pnpm eval`）覆盖以上；CI 全门禁绿；故意破坏（state 不单次 / 开放重定向 / 归一串号 / 不验邮箱）任一即变红。
- **依赖**：S14-T1…T6。

### S14-T8 · 文档回写 + Demo
- **做**：更新 README（OAuth/SSO：env `GOOGLE_*`/`GITHUB_*`、redirect URI、stub vs 真 provider、回跳 allowlist）/ARCHITECTURE（§1 适配器矩阵加 `AuthProvider`；身份/登录数据流）/CLAUDE/AGENTS（身份铁律）。Demo 端到端（离线 stub 可演示）；Sprint 14 DoD 勾选。
- **DoD**：新人按 README 在 stub 模式走通 Google/GitHub 登录；env 文档准确；Demo 离线可演示。
- **依赖**：S14-T1…T7。

---

## 执行顺序与并行建议

```
S14-T1(AuthProvider+Stub+身份仓库) ─ S14-T2(Google/GitHub) ─┬─ S14-T3(start/callback)
                                                            └─ ...
                              S14-T3 ─┬─ S14-T4(账号归一/多身份)
                                      ├─ S14-T5(登录 UI)
                                      └─ S14-T6(身份安全)
                                全部收口 → S14-T7(测试) → S14-T8(Docs)
```
- **关键路径**：S14-T1（Provider + 身份/状态仓库）→ S14-T2（真 provider）→ S14-T3（start/callback）是地基；归一/UI/安全在其上并行。
- **每完成一个任务**：跑该模块测试 + 相关回归；一任务一 PR，CI 绿即合；提交说明写清「动了哪个 provider/端点 + 加了哪个测试」。
- **建议 PR 分组**：A(T1+T2) · B(T3+T4) · C(T5+T6) · D(T7+T8)。

## Sprint 14 Definition of Done（整体验收）
- [ ] 身份 Provider：`AuthProvider`（Stub 离线 / Google + GitHub env 门控）+ `OAuthIdentity` + 仓库（内存 + Postgres）；OAuth token 不落库。
- [ ] OAuth 流程：start（state+PKCE）+ callback（验 state→换 code→取 identity→签发会话→回跳 allowlist）。
- [ ] 账号归一：按已验证邮箱 link/建用户，密码 + 多 OAuth 身份同属一用户；`me` 列已连身份。
- [ ] 安全：state 单次+过期+CSRF、开放重定向 allowlist、token 不入日志/响应、emailVerified fail-closed、link/login 审计。
- [ ] 登录/注册 UI：Google/GitHub 按钮（仅展示已注册）+ 设置页已连账号。
- [ ] `pnpm test` + `pnpm test:web` 覆盖全流程/归一/CSRF/重定向/邮箱校验/UI；CI 全门禁绿。
- [ ] README/架构文档更新；Demo 离线（stub）可演示。

## 风险与提示（给代理）
- **复用会话，不另造**：OAuth 成功后一律走既有 `startSession`（签名 httpOnly + 过期 + 登出失效）；不要发明第二套会话/令牌。
- **state 是 CSRF 命脉**：单次 consume、过期、与 PKCE verifier 绑定；丢失/重放/伪造一律拒。回调前先校 state，再换 code。
- **开放重定向**：callback 的最终回跳目标只允许 allowlist（默认本应用源 / `CORS_ORIGIN`）；绝不回跳到 provider 或外部传入的任意 URL。
- **归一靠已验证邮箱**：`upsertByEmail` 已按 email 去重——OAuth 命中同邮箱即 link 到既有用户；emailVerified=false 必须拒（否则邮箱劫持串号）。
- **token 纪律**：优先**不存** OAuth access/refresh token（拿到 email 即可签发自有会话）；非存不可则 `SECRETS_KEY` 加密，绝不入日志/审计/响应/`me`。
- **provider 可换挡**：Stub 离线默认（确定性、CI 可跑）、Google/GitHub env 门控；缺 key 不注册该 provider；UI 只展示后端实际注册的 provider。
- **demo 不削弱生产**：stub 仅在无真 provider 时用于离线演示；生产默认走真 provider + allowlist。
- **诚实边界**：真实 Google/GitHub 端到端是部署事项（需在其控制台配 redirect URI）；本 Sprint 测 stub 全流程 + 真 provider 的 userinfo 映射/签名逻辑，PR 写明。
- **不确定/不可逆**（state 存储后端、PKCE 方式、emailVerified 缺省策略、回跳 allowlist 来源）→ 选保守默认并在 PR 标注。
