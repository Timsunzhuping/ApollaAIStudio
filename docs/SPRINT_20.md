# Sprint 20 执行单 — Account Security：MFA（TOTP）+ 无密码魔法链接

> 读者：**Codex / Claude Code**。逐任务从上往下执行；每个任务自带验收（DoD）、依赖、改动位置。
> 前置必读：[ARCHITECTURE.md](./ARCHITECTURE.md)（§安全周界）· [AGENTS.md](../AGENTS.md)（安全周界铁律 S10）· `apps/bff/src/auth.ts`（`startSession`/`readSession`/签名 httpOnly 会话、`SESSION_SECRET` 签名）· `packages/harness-core`（`hashPassword`/`verifyPassword` scrypt、`encryptSecret`/`decryptSecret` SECRETS_KEY、`NotificationDelivery` 投递抽象）· `packages/adapters/db/postgres`（`ALTER TABLE users ADD COLUMN IF NOT EXISTS` 迁移范式、`OAuthStateStore` 单次过期态范式）· Sprint 10（密码 + 签名会话 + 限流 + 审计）· Sprint 14（OAuth + 账号归一）。
> 目标产物（Sprint Demo）：**① 设置页开启 MFA（扫 otpauth 二维码 + 验码确认 + 备份码）→ 退出 → 登录时密码后**强制要第二因子（TOTP 或备份码）**才发会话；② "给我发登录链接" → 邮箱（离线 Stub 投递）收到**单次、限时、签名**的魔法链接 → 点开免密登录。** 全程 fail-closed、限流、审计；TOTP secret 加密落库、备份码 scrypt 哈希、魔法链接 token 签名单次；时钟可注入（测试确定性），离线 hermetic。

## 0. Sprint 范围与非目标

**主题**：S10 给了密码 + 签名会话，S14 给了 OAuth/SSO——但账号安全还差两块现代 To-C 产品的标配：**第二因子（MFA）**与**无密码登录（魔法链接）**。一个有计费、有真实身份的产品，登录只有"单密码"是不够的。本 Sprint 把身份故事补全成完整的账号安全套件：**密码（S10）→ OAuth（S14）→ MFA + 无密码（S20）**。两者都建立在既有原语上（签名会话、scrypt、SECRETS_KEY 加密、投递抽象），且**确定性可离线测**（TOTP 注入时钟、魔法链接 Stub 投递），不引入新外部依赖。

**做（本 Sprint 的闭环）**
- TOTP 核心：RFC 6238（HMAC-SHA1、30s、±1 步容错）generate/verify（**注入时钟**）；secret 生成 + `otpauth://` URI；**备份码**（生成 + scrypt 哈希 + 单次消费）。
- 魔法链接核心：**签名、单次、限时** token（generate/verify）；经既有 `NotificationDelivery`（**Stub 离线 / 真实邮件 env**）投递；单次态仓库（内存 + Postgres，参照 `OAuthStateStore`）。
- BFF 流程 + 存储：MFA 注册（enroll→verify 确认）+ **登录 step-up**（密码/OAuth 通过后，若启用 MFA 则**不发完整会话**，先要第二因子，验过 TOTP/备份码再 `startSession`）+ 关闭 MFA；魔法链接 请求/校验端点。`users` 加 MFA 列（**TOTP secret 加密**、备份码哈希、`mfa_enabled`）。
- Web UI：设置页开启/关闭 MFA（otpauth 二维码/密钥 + 验码 + 备份码一次性展示）；登录页 MFA 挑战步骤 + "邮件登录链接" 无密码入口 + 校验落地。
- 安全：**MFA step-up fail-closed**（pending 态在验过第二因子前**无任何受保护访问**）；TOTP secret 加密落库、备份码 scrypt 哈希、魔法链接 token 签名单次限时；**账号枚举安全**（魔法链接请求恒 200、MFA 登录错误信息通用）；每个鉴权端点**限流 + 审计**；secret/备份码/token **绝不入日志**。
- 质量闸门：TOTP 已知向量/时钟偏移/重放；备份码单次；魔法链接 单次/过期/签名；MFA step-up（无第二因子拿不到完整会话）；枚举安全；Web UI；eval；全程 hermetic（注入时钟 + Stub 投递，无邮件/网络）。

**不做（留待 Sprint 21+）**
- **WebAuthn / passkeys**、硬件 U2F、SMS/推送 MFA；**记住此设备 / 设备信任**、风险自适应 MFA。
- 真实邮件 provider 硬化（用 Stub 投递 + 文档说明 env）；组织级强制 MFA 策略；客服/人工账号恢复。
- **MFA 叠加在 OAuth/魔法链接上的深度**（本 Sprint：密码登录走完整 step-up；OAuth 与魔法链接默认按"已有因子"发会话，MFA-on-那两条路标注为后续，机制上预留）。
- 把 MFA/魔法链接接进浏览器扩展（扩展仍用 API token）。

**全程铁律**（违反即返工，见 [AGENTS.md](../AGENTS.md)）：**MFA step-up fail-closed**——启用 MFA 的账号，密码正确 ≠ 登录成功；未验第二因子的 pending 态**不得**访问任何受保护路由或拿到完整会话；**TOTP secret 加密落库**（`SECRETS_KEY`），**备份码 scrypt 哈希 + 单次**，**魔法链接 token 签名 + 单次 + 短过期**，三者**绝不入日志/响应**（备份码仅注册时一次性明文展示）；**账号枚举安全**（魔法链接请求恒 200、MFA/登录错误通用、定时无差别）；时钟**注入**（测试确定性），生产用真实时间；每个鉴权端点**限流 + 审计**；会话签发**复用** `startSession`（不另造会话机制）；复用 S10 scrypt/会话 + S11 `SECRETS_KEY` 加密 + S5 投递抽象；**demo 不削弱生产**（MFA 可选，但启用即强制）；改动集中在 `contracts`、`harness-core`(auth)、`apps/bff`、`apps/web`、`db-postgres`、`docs`、`evals`；每个能力配测试。

---

## 里程碑 A — TOTP 核心 + 魔法链接核心

### S20-T1 · TOTP（RFC 6238）+ 备份码
- **做**：`harness-core/src/auth/totp.ts`：`generateTotp(secret, {now})` / `verifyTotp(secret, code, {now, window:1})`（HMAC-SHA1、30s、±1 步、Base32 secret）；`newTotpSecret()` + `otpauthUri(secret, {issuer, account})`；`newRecoveryCodes(n=10)` + `hashRecoveryCode`/`verifyRecoveryCode`（复用 scrypt）。`contracts` 加 `MfaEnrollment`（otpauthUri/recoveryCodes 一次性）。
- **DoD**：已知 RFC 6238 测试向量通过；±1 步容错、超窗拒、重放（同一 30s 同码）由上层防（标注）；备份码生成/哈希/单次校验；注入时钟确定性。
- **改动**：`harness-core/src/auth/totp.ts`、`contracts/src/mfa.ts`。
- **依赖**：S10 scrypt。

### S20-T2 · 魔法链接（签名单次限时 token + 投递）
- **做**：`harness-core/src/auth/magiclink.ts`：`newMagicToken({userId, now, ttl})`（HMAC 签名、内含 userId+exp+nonce）/ `verifyMagicToken(token, {now})`；`MagicLinkRepository`（单次态：`consume(token) → bool`，内存 + Postgres，参照 `OAuthStateStore`）。投递经既有 `NotificationDelivery`（Stub 离线把链接存/打日志标记、真实邮件 env）。
- **DoD**：签名往返、过期拒、篡改拒；`consume` 单次（二次失败）；Stub 投递离线可取链接做测试。
- **改动**：`harness-core/src/auth/magiclink.ts`、`db-postgres`（magic_links 表）。
- **依赖**：S10 签名、S5 投递。

---

## 里程碑 B — BFF 流程 + 存储

### S20-T3 · MFA 注册 + 登录 step-up
- **做**：`users` 加列（`totp_secret`(加密)、`recovery_codes`(哈希数组)、`mfa_enabled`）+ UserRepository MFA 方法。端点：`POST /api/auth/mfa/enroll`（生成 secret 加密暂存 + 返 otpauth + 备份码一次性）→ `POST /api/auth/mfa/verify`（验码 → `mfa_enabled=true`）；`POST /api/auth/mfa/disable`（验码/密码后关闭）。**登录 step-up**：`/api/auth/login` 密码通过且 `mfa_enabled` → **不发完整会话**，发**短时 pending 凭证** → `POST /api/auth/mfa/login`（TOTP 或备份码 → `startSession` 完整会话）。
- **DoD**：开启 MFA 全流程通；启用后仅密码**拿不到**完整会话（pending 态访问受保护路由 401）；TOTP 或备份码均可过；备份码单次；关闭 MFA 需二次验证。
- **改动**：`apps/bff/src/auth.ts`/`server.ts`、`db-postgres`(users 列 + repo)、`harness-core`(UserRepository 接口)。
- **依赖**：S20-T1、S10 会话/限流/审计、S11 加密。

### S20-T4 · 魔法链接端点
- **做**：`POST /api/auth/magic-link/request`（`{email}` → **恒 200**；存在则签发 token + 投递）；`POST /api/auth/magic-link/verify`（`{token}` → 验签/过期/单次 → `startSession`）。限流、审计、枚举安全。
- **DoD**：请求恒 200（不泄露账号是否存在）；有效 token → 登录；过期/篡改/二次用 → 拒；限流生效；落审计；token 不入响应/日志（仅投递通道）。
- **依赖**：S20-T2、S10 会话/限流/审计。

---

## 里程碑 C — Web UI

### S20-T5 · 设置页 MFA
- **做**：`apps/web` 设置页加 "两步验证" 卡片：未启用 → enroll（展示 otpauth 二维码/密钥 + 输入验码确认 + **一次性备份码**）；已启用 → 状态 + 关闭（需验证）。
- **DoD**：浏览器：开启 → 扫码 → 验码 → 显示备份码 → 已启用；关闭走通；组件测试（mock fetch）。
- **依赖**：S20-T3、S9 前端。

### S20-T6 · 登录页 MFA 挑战 + 无密码入口
- **做**：登录页：密码登录返回 pending → 显示 **MFA 挑战步骤**（输入 TOTP/备份码 → 完整登录）；加 "邮件登录链接" 入口（输入邮箱 → 请求 → 提示查收）；魔法链接校验落地页（带 token → 自动校验 → 进工作台）。
- **DoD**：浏览器：启用 MFA 的账号登录 → 挑战 → 进站；请求魔法链接 → 提示；带 token 落地 → 登录；组件测试（mock fetch）。
- **依赖**：S20-T3/T4、S9 前端。

---

## 里程碑 D — 质量闸门

### S20-T7 · Eval/测试扩展
- **做**：TOTP 已知向量 + 时钟偏移 + 超窗拒；备份码单次；魔法链接 单次/过期/签名/篡改；**MFA step-up**（pending 态无完整会话/受保护 401）；枚举安全（魔法链接恒 200）；MFA 关闭需验证；Web UI（mock fetch）。可加 1 项 eval（TOTP verify 向量 + step-up 语义）。全程 hermetic（注入时钟 + Stub 投递，无邮件/网络）。
- **DoD**：`pnpm test` + `pnpm test:web` + `pnpm e2e` 全绿且 hermetic；故意破坏（step-up 非 fail-closed / 备份码可重用 / 魔法链接可重放 / 枚举泄露 / secret 不加密）任一即变红。
- **依赖**：S20-T1…T6。

### S20-T8 · 文档回写
- **做**：README（账号安全：MFA TOTP 接验证器、备份码、魔法链接 env/投递、Stub vs 真实邮件、安全语义）；ARCHITECTURE（§安全周界加 MFA/魔法链接；登录 step-up 数据流；密码/OAuth/MFA/无密码 全景）；CLAUDE/AGENTS（账号安全铁律）；Sprint 20 DoD 勾选。
- **DoD**：新人照 README 开启 MFA + 用魔法链接登录（Stub 投递）跑通；文档准确。
- **依赖**：S20-T1…T7。

---

## 执行顺序与并行建议

```
S20-T1(TOTP+备份码) ─ S20-T2(魔法链接) ─ S20-T3(MFA 端点+step-up) ─┬─ S20-T4(魔法链接端点)
                                                                  ├─ S20-T5(设置页 MFA)
                                                                  └─ S20-T6(登录挑战+无密码)
                                                      全部收口 → S20-T7(测试) → S20-T8(Docs)
```
- **关键路径**：S20-T1（TOTP）→ S20-T2（魔法链接）→ S20-T3（MFA 端点 + step-up）是地基；魔法链接端点/UI 在其上并行。
- **每完成一个任务**：跑该模块测试 + 既有回归 + `pnpm e2e`；一任务一 PR，CI 绿即合。
- **建议 PR 分组**：A(T1+T2) · B(T3+T4) · C(T5+T6) · D(T7+T8)。

## Sprint 20 Definition of Done（整体验收）
- [x] TOTP（RFC 6238，注入时钟）+ 备份码（scrypt 哈希 + 单次）+ `otpauth` URI + `MfaEnrollment` 契约。
- [x] 魔法链接（签名 + 单次 + 限时 token + 投递）+ 单次态仓库（内存 + Postgres）。
- [x] MFA 注册/验证/关闭 + **登录 step-up**（启用后仅密码拿不到完整会话）；`users` MFA 列（secret 加密、备份码哈希）。
- [x] 魔法链接 请求（恒 200）/ 校验（→会话）端点，限流 + 审计 + 枚举安全。
- [x] Web：设置页 MFA + 登录 MFA 挑战 + 无密码入口/落地。
- [x] 安全：step-up fail-closed、secret 加密、备份码/token 哈希·签名单次、不入日志。
- [x] `pnpm test` + `pnpm test:web` + `pnpm e2e` 全绿且 hermetic（注入时钟 + Stub 投递）。
- [x] README/架构文档更新。

> **Sprint 20 完成**（PR [#111](https://github.com/Timsunzhuping/ApollaAIStudio/pull/111) A · [#112](https://github.com/Timsunzhuping/ApollaAIStudio/pull/112) B · [#113](https://github.com/Timsunzhuping/ApollaAIStudio/pull/113) C · D 本次）。**MFA（TOTP RFC 6238，注入时钟、对齐测试向量 287082）+ scrypt 哈希单次备份码**；`users` 加 **加密 TOTP secret**(`SECRETS_KEY`)/备份码哈希/`mfa_enabled`；**登录 step-up**——密码通过 + 启用 MFA → 域隔离短时签名 **pending 凭证**(不可当会话/魔法链接复用)，`/api/auth/mfa/login` 验 TOTP/单次备份码后才 `startSession`(**fail-closed**)；MFA enroll/verify/disable；**无密码魔法链接**(`newMagicToken`/`verifyMagicToken` 签名单次限时 + `MagicLinkRepository` 单次态 + `StubMagicLinkDelivery` 离线投递)，请求**恒 200**(枚举安全)；设置页 MFA 卡片 + 登录 MFA 挑战 + 无密码入口/`/auth/magic` 落地;限流 + 审计、secret/码/token 不入日志。新增 eval `account-security`(42)。315 root + 25 web + 9 e2e 绿。WebAuthn/passkeys/SMS/设备信任/真实邮件硬化/MFA-on-OAuth 深度列为后续。

## 风险与提示（给代理）
- **step-up 是命脉**：启用 MFA 后，密码/OAuth 通过只产生**短时 pending 凭证**，**绝不**等于完整会话；pending 态访问任何受保护路由必须 401；只有验过 TOTP/备份码才 `startSession`。这一条破了整个 MFA 就是摆设。
- **secret/码/token 纪律**：TOTP secret 加密落库（`SECRETS_KEY`）、备份码 scrypt 哈希、魔法链接 token 签名；备份码明文**仅注册时一次性**展示，之后不可再取；三者绝不进日志/审计/响应。
- **枚举安全**：魔法链接请求**恒 200**（无论邮箱是否存在）；MFA/登录失败用**通用**错误信息 + 等时，别泄露"密码对但缺第二因子"之外可推断账号存在的差异（"缺第二因子"本身只在密码已验后出现，可接受）。
- **时钟注入**：TOTP/魔法链接的时间从注入时钟取（测试确定性、可测时钟偏移/过期），生产用真实时间；±1 步容错处理时区/漂移。
- **复用既有**：会话走 `startSession`、加密走 `SECRETS_KEY`、哈希走 scrypt、投递走 `NotificationDelivery`（Stub 离线）——不另造。
- **限流 + 审计**：enroll/verify/mfa-login/magic-request/magic-verify 全部限流 + 落审计；魔法链接请求尤其要限流（防刷邮件）。
- **诚实边界**：真实邮件投递是部署事项；本 Sprint 用 Stub 投递离线测全流程，PR 写明；WebAuthn/passkeys/SMS 明确不做。
- **不确定/不可逆**（备份码个数/长度、魔法链接 TTL、pending 凭证 TTL、TOTP 容错步数、OAuth/魔法链接是否叠加 MFA）→ 选保守默认并在 PR 标注。
