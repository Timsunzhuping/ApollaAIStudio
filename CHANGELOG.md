# Changelog

All notable changes to **Apolla AI** are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); the project uses sprint-based development where each
sprint ships as a small set of CI-green-then-merged PRs.

## [1.0.0] — 2026-06-29

First general-availability release. The platform is a harness-architecture To-C AI workbench: the model
is a swappable, ever-improving capability provider; the platform owns routing, context, tools, memory,
security, evals, and delivery. Every capability is a swappable adapter with an offline stub default and
an env-gated real provider, so "upgrade = swap a provider."

### Foundations (Sprints 01–09)
- **01 — Harness Core:** model router, adapter interface, deterministic stub providers.
- **02 — Persistence & personalization:** repositories, user model/memory, skills.
- **03 — Multimodal media:** image/video generation behind swappable providers + object store.
- **04 — Tool ecosystem:** tool runtime, risk inference, low-risk auto-execution, audit.
- **05 — Proactive autonomy:** durable jobs, scheduler, notifications.
- **06 — Cowork mode:** role-based plugins, parallel sub-agent orchestration, clarification.
- **07 — Workspace & files:** versioned virtual filesystem, file-aware tools, write guard (path isolation/quota/audit).
- **08 — Text product surfaces:** declarative surface substrate (Translator/Sheets/Meeting Notes), structured output.
- **09 — Production web frontend:** Vite+React SPA, typed API client + SSE hook, auth gate (pure client; BFF stays the sole backend).

### Hardening & ecosystem (Sprints 10–18)
- **10 — Production hardening & security:** scrypt password auth + signed httpOnly sessions, multi-tenant isolation (4 IDOR fixes), rate limiting, security headers/CORS/body limits, metrics, durable job recovery, graceful shutdown.
- **11 — Open tool ecosystem:** HTTP/SSE MCP transport, connector marketplace, remote-tool safety (encrypted secrets, untrusted output, health probe).
- **12 — Browser extension:** MV3 select-text → research/translate/summarize → side panel → save to workspace; scrypt-hashed API tokens + Bearer auth.
- **13 — Billing & monetization:** swappable PaymentProvider (Stripe), declarative plans, fail-closed entitlements, signature-verified idempotent webhooks (card data never touches our servers).
- **14 — Identity & SSO:** swappable AuthProvider (Google/GitHub OAuth+OIDC), single-use+PKCE state, account unification by verified email (tokens never persisted).
- **15 — End-to-end tests & release readiness:** Playwright suite over the real stack, single-origin SPA serving, hermetic & offline.
- **16 — Scale & reliability:** swappable JobQueue (Redis/BullMQ), standalone worker, idempotent consume, single-point scheduler.
- **17 — Observability:** swappable Tracer (OpenTelemetry), cross-process trace propagation, per-op SLO metrics (spans never carry secrets/PII).
- **18 — Apolla as an MCP server:** expose read-only/low-risk capabilities as owner-scoped MCP tools (the dual of S11).

### Capabilities & lifecycle (Sprints 19–24)
- **19 — Voice & speech I/O:** swappable SpeechProvider (Whisper + TTS); transcripts are untrusted data.
- **20 — Account security:** RFC 6238 TOTP MFA + scrypt recovery codes, fail-closed login step-up, passwordless magic links.
- **21 — Realtime collaboration:** RGA text CRDT (converges for any op order), SSE op-sync, signed doc sharing (ops are data).
- **22 — Account & data lifecycle:** export (redacted, no secrets) / delete (cascade purge + session revoke) / import (re-owned to the caller).
- **23 — Admin & operations console:** operator dashboard, cross-owner audit, user management + grant-plan; admin authz fail-closed via `ADMIN_EMAILS` (no self-escalation).
- **24 — 1.0 release & hardening:** production fail-fast config validation, `/api/version` + `/api/ready` probes, version surfaced in the web, CHANGELOG/SECURITY/RELEASE_NOTES, version → 1.0.0.

### Security posture
Owner-scoped multi-tenant isolation (fail-closed); secrets encrypted at rest and never logged/exported;
signed httpOnly sessions with logout revocation; remote/page/tool/transcript/op content is untrusted
data, never instructions; provider-hosted checkout (no card data); fail-closed entitlements, MFA, OAuth
state, and admin authz. See [SECURITY.md](SECURITY.md).

[1.0.0]: https://github.com/Timsunzhuping/ApollaAIStudio
