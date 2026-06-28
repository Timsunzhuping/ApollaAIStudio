# Apolla AI 1.0

Apolla AI reaches **1.0** — a production-ready, harness-architecture To-C AI workbench. The model is a
swappable, ever-improving capability provider; the platform owns routing, context, tools, memory,
security, evaluation, and delivery. Every capability is an adapter with an offline stub default and an
env-gated real provider, so **"upgrade = swap a provider"** — the platform gets stronger as models do.

## What you get in 1.0

- **A complete workbench.** Research with citations, multimodal media, a versioned workspace + files,
  declarative text surfaces (translate / sheets / meeting notes), proactive jobs + scheduling, and a
  Cowork mode with parallel role-based sub-agents — all behind a production React web app.
- **Realtime collaboration.** CRDT-backed shared documents that converge under concurrent edits, with
  live sync and signed document sharing.
- **Voice in and out.** Speak a question, hear the answer (transcripts are treated as untrusted data).
- **An open ecosystem.** Connect MCP tools/connectors, or expose Apolla's own capabilities as an MCP
  server; a browser extension brings research/translate/summarize to any page.
- **Accounts done right.** Email + password, Google/GitHub SSO, TOTP MFA + recovery codes, passwordless
  magic links, API tokens, and a full data lifecycle — export, delete, and import your data.
- **Operability.** Distributed job queue, OpenTelemetry tracing, metrics + SLOs, an operator console,
  health/version/readiness probes, and graceful shutdown.
- **Monetization.** Stripe billing with declarative plans and fail-closed entitlements (card data
  never touches our servers).

## Security by construction

Multi-tenant isolation (fail-closed), encrypted secrets that never leak, signed sessions, MFA, OAuth
state binding, untrusted-content-is-data, provider-hosted checkout, and admin authz with no
self-escalation — each enforced by tests and offline evals. Production **fails fast** on insecure
configuration instead of booting unsafe. See [SECURITY.md](SECURITY.md).

## Quality bar

Every change ships CI-green: build, typecheck, lint, unit/integration tests, a web component suite, an
end-to-end Playwright suite over the real stack, and **46 deterministic product evals**. All tests are
hermetic and offline.

See [CHANGELOG.md](CHANGELOG.md) for the full sprint-by-sprint history (Sprints 01–24).
