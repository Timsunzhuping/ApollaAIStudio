# Deploying Apolla AI Studio

Apolla deploys as **a single origin**: the BFF (`apps/bff`) serves both the JSON/SSE API and the
built web SPA (`apps/web/dist`). Single-origin means session cookies and SSE "just work" — no CORS
or cross-origin-cookie configuration for the first-party web app. (The browser extension is the only
cross-origin client; it authenticates with API tokens, not cookies — see [SPRINT_12](./SPRINT_12.md).)

## 1. Build

```bash
pnpm install --frozen-lockfile
pnpm build                      # builds all packages
pnpm --filter @apolla/web build # → apps/web/dist (the SPA the BFF serves)
```

## 2. Run the server

```bash
WEB_DIST=/abs/path/to/apps/web/dist \
DATABASE_URL=postgres://user:pass@host:5432/apolla \
SESSION_SECRET=$(openssl rand -base64 32) \
AUTH_MODE=password \
NODE_ENV=production \
PORT=3000 \
pnpm --filter @apolla/bff start
```

- `WEB_DIST` — absolute path to the built SPA. **Unset → the BFF serves only its inline fallback UI**
  (no SPA). Set it in production. Static assets are served by path; unknown non-API GETs fall back to
  `index.html` for client-side routing.
- The BFF auto-runs the idempotent DB migration on boot and reconciles interrupted jobs.

## 2b. Background jobs: in-process vs. distributed (S16)

Long-running jobs (research / media / cowork / scheduled tasks) run behind a swappable **JobQueue**.

- **In-process (default).** `REDIS_URL` unset → the web process executes jobs itself and runs the
  cron scheduler. Simplest; fine for a single instance. No broker needed.
- **Distributed.** Set `REDIS_URL` → the web **only enqueues**; one or more standalone **workers**
  execute jobs and **one** worker owns the cron scheduler (single point — no double-ticking). Jobs
  survive web/worker restarts (persisted + reconciled), and workers scale horizontally.

```bash
# Distributed: web (enqueue-only) + worker(s) + Redis, sharing Postgres + REDIS_URL.
REDIS_URL=redis://redis:6379 WEB_DIST=/abs/apps/web/dist DATABASE_URL=... pnpm --filter @apolla/bff start
REDIS_URL=redis://redis:6379 DATABASE_URL=... WORKER_PORT=3100 pnpm --filter @apolla/job-worker start
```

Scale by running more `@apolla/job-worker` processes (tune `JOB_CONCURRENCY`). Run **exactly one**
scheduler-owning worker, or accept that every worker ticks (each tick is deduped per task/minute, so
duplicate ticks are harmless but wasteful). Worker exposes `GET /health` when `WORKER_PORT` is set;
SIGTERM drains in-flight jobs before exit.

## 3. Environment variables

| Var | Purpose | Notes |
|---|---|---|
| `DATABASE_URL` | Postgres connection | Unset → in-memory (dev/e2e only; not durable) |
| `SESSION_SECRET` | Signs session cookies | **Required in prod**; rotate to invalidate all sessions |
| `AUTH_MODE` | `password` disables zero-config email-only login | Implied when `NODE_ENV=production` |
| `NODE_ENV` | `production` → `Secure` cookies + password mode | Serve over HTTPS in prod |
| `WEB_DIST` | Path to `apps/web/dist` (single-origin SPA) | See §2 |
| `CORS_ORIGIN` | Comma-separated allowlist for cross-origin clients | e.g. the browser extension origin |
| `REDIS_URL` | Distributed job queue broker (BullMQ) | Unset → in-process jobs (no broker) |
| `JOB_CONCURRENCY` / `JOB_ATTEMPTS` / `JOB_BACKOFF_MS` / `JOB_TIMEOUT_MS` | Worker tuning (S16) | Concurrency, retry attempts + exponential backoff, per-job timeout (0=off) |
| `WORKER_PORT` | Worker health endpoint port | Unset → no health server |
| `SECRETS_KEY` | AES-GCM key for connector secrets (S11) | Required if using connectors with secrets |
| `MEDIA_DIR` | Local media storage dir (S3) | |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | LLM (also text→image) | Missing → deterministic stub |
| `TAVILY_API_KEY` | Web search | Missing → stub |
| `SEEDANCE_API_KEY` / `SEEDANCE_BASE_URL` | Text→video | Missing → stub |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_<PLAN>` | Billing (S13) | Missing → stub payment provider |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth (S14) | Missing → provider not registered |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth (S14) | Missing → provider not registered |

For real OAuth, register the callback `https://<your-host>/api/auth/oauth/<provider>/callback` in the
provider console. For Stripe, point the webhook at `https://<your-host>/api/billing/webhook`.

## 4. Health & observability

- `GET /api/health` — liveness + mode/persistence.
- `GET /metrics` — aggregate request metrics (no secrets/PII), suitable for a readiness probe.

## 5. End-to-end smoke

The Playwright e2e suite (`pnpm e2e`) runs the exact single-origin serving path against a hermetic
in-memory BFF + stub providers (no network). It is the integration net over the unit/contract/web
tests + evals. See [SPRINT_15](./SPRINT_15.md).
