# Security Policy

Apolla AI is a multi-tenant To-C AI workbench. Security is enforced as a set of invariants ("iron
laws") that every change must uphold; they are encoded in code, tests, and evals. This document
summarizes the threat model and those invariants. It contains **no real secrets, keys, or internal
hosts** — configuration is supplied only via environment variables at deploy time (see
[docs/DEPLOY.md](docs/DEPLOY.md)).

## Reporting a vulnerability

Please report suspected vulnerabilities privately to the maintainers (security contact: _to be
configured by the operator_) rather than opening a public issue. Include reproduction steps and
impact. We aim to acknowledge promptly and coordinate a fix and disclosure.

## Threat model (summary)

- **Tenants are mutually distrusting.** A user must never read or write another user's data. Every
  `:id` / SSE / confirm / admin endpoint is owner-scoped and fail-closed.
- **Untrusted content is data, not instructions.** Web pages, tool/connector output, transcripts, and
  collaboration ops are never executed as commands and never auto-trigger high-risk actions.
- **The network and inbound headers are untrusted.** Inbound `traceparent` is correlation-only;
  webhook bodies are signature-verified over the raw payload and idempotent.
- **Secrets must never leak.** Not in logs, traces, responses, exports, or error messages.

## Invariants (enforced per domain)

- **Isolation (S10):** owner-scoped repositories; cross-tenant access fails closed; IDOR-tested.
- **Auth & sessions (S10, S14, S20):** scrypt-hashed passwords; signed httpOnly sessions with expiry +
  logout revocation; OAuth state single-use + PKCE-bound + open-redirect allowlist; account unification
  only by verified email; OAuth tokens never persisted.
- **MFA (S20):** login step-up is fail-closed — a correct password yields only a short-lived,
  domain-separated pending credential (never a session) until a TOTP or single-use recovery code
  verifies. TOTP secrets encrypted at rest; recovery codes scrypt-hashed + single-use; magic-link
  tokens signed, single-use, short-expiry; requests are enumeration-safe (always 200).
- **Secrets (S11):** connector secrets AES-GCM encrypted via `SECRETS_KEY`, sent only to the
  configured host, never logged, never exported.
- **Remote tools / MCP (S11, S18):** remote output is untrusted; only read-only/low-risk capabilities
  are exposed; args are zod-validated; per-call owner-scoped + rate-limited + audited.
- **Billing (S13):** card data never touches our servers (provider-hosted checkout; store only a
  provider reference + status); webhooks verify signature over the raw body + are idempotent;
  entitlements fail closed to the free plan.
- **Tracing (S17):** spans never carry secrets/PII (secret keys dropped, owner ids hashed); tracing
  never changes behavior.
- **Collaboration (S21):** CRDT converges for any op order; doc access is owner/share-scoped and fail
  closed; share tokens are signed + scoped to one document; ops are data.
- **Data lifecycle (S22):** export is owner-scoped and strips every secret; account deletion requires
  email re-confirmation, cascades all owner-keyed data, and revokes sessions; import re-owns every row
  to the caller (no impersonation) and never imports secrets/privilege.
- **Admin (S23):** admin rights come only from the `ADMIN_EMAILS` allowlist (no client field, no
  user-writable column → no self-escalation); `/api/admin/*` is fail-closed; admins see aggregate +
  metadata only, never another user's private content; actions are audited.
- **Release (S24):** production fails fast on insecure configuration (a missing/default
  `SESSION_SECRET` refuses to boot) rather than running unsafe; health/version/readiness probes never
  expose secrets or connection strings.

## Transport & headers

Served single-origin in production over HTTPS with `Secure` cookies, security headers, CORS allowlist,
and request body-size limits (S10). Per-IP and per-owner rate limiting protects every route.
