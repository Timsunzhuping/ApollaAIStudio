import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { extname, normalize, join } from 'node:path';
import { exportArtifact, autoDraftSkill, embedMedia, encryptSecret, decryptSecret, inferRisk, AgentOrchestrator, nextRun, resolveEntitlements, hasFeature, newState, newPkce } from '@apolla/harness-core';
import type { ResolvedIdentity } from '@apolla/harness-core';
import type { Connector, Subscription, WebhookEvent, PlanDef } from '@apolla/contracts';
import { hashPassword, verifyPassword, newApiToken } from '@apolla/harness-core';
import { buildHarness, type Harness } from './harness';
import { readSession, readBearer, startSession, endSession } from './auth';
import { applySecurityHeaders, applyCors, clientIp, limiters, isExpensive, MAX_BODY_BYTES } from './security';
import { observe, metrics, type ObservedResponse } from './obs';
import { reconcileJobs, withSpanContext, McpServer, type JsonRpcRequest } from '@apolla/harness-core';
import { buildCapabilityTools } from './mcp-tools';
import { UI_HTML } from './ui';

// Assigned by the entry point (or by tests via setHarness) — keeps handlers free of a build-at-import
// singleton so the handler can be exercised against a constructed harness.
let harness: Harness;
let mcpServer: McpServer | undefined; // built lazily from the harness on first /api/mcp call (S18)
export function setHarness(h: Harness): void {
  harness = h;
  mcpServer = undefined;
}

// Single-origin SPA serving (S15): when WEB_DIST points at a built `apps/web/dist`, the BFF serves
// the SPA + assets so the frontend is same-origin (cookies + SSE just work). Off when unset (the
// inline UI_HTML + JSON-404 behavior is unchanged).
const WEB_DIST = process.env.WEB_DIST;
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json', '.webmanifest': 'application/manifest+json',
};

/** Resolve an existing file under WEB_DIST for `pathname` (path-traversal guarded), or null. */
function spaFile(pathname: string): string | null {
  if (!WEB_DIST) return null;
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  const abs = join(WEB_DIST, rel);
  if (!abs.startsWith(WEB_DIST)) return null; // traversal guard
  return existsSync(abs) && extname(abs) ? abs : null;
}
function sendFile(res: ServerResponse, abs: string): void {
  res.writeHead(200, { 'content-type': MIME[extname(abs)] ?? 'application/octet-stream' });
  res.end(readFileSync(abs));
}
/** Serve the SPA index.html (client-side routing fallback) if WEB_DIST is configured. */
function sendSpaIndex(res: ServerResponse): boolean {
  if (!WEB_DIST) return false;
  const index = join(WEB_DIST, 'index.html');
  if (!existsSync(index)) return false;
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(readFileSync(index));
  return true;
}

// Production requires a password; demo mode keeps zero-config (email-only) login.
const PASSWORD_MODE = process.env.AUTH_MODE === 'password' || process.env.NODE_ENV === 'production';

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function projectContext(projectId: string | undefined, ownerId: string): Promise<string | undefined> {
  if (!projectId) return undefined;
  const p = await harness.projects.get(projectId);
  if (!p || p.ownerId !== ownerId) return undefined;
  return `Project context — "${p.name}": ${p.description}`.trim();
}

/** Read the raw request body (for webhook signature verification — must not be JSON-parsed). */
async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** A safe in-app landing target — relative path only (blocks open redirects to other origins). */
function isSafeRelativePath(p: string): boolean {
  return p.startsWith('/') && !p.startsWith('//') && !p.includes('://') && !p.includes('\\');
}

/**
 * Resolve (or create + link) the user for a verified OAuth identity (S14-T4). Account unification is
 * by VERIFIED email: an unverified email is rejected fail-closed; an existing same-email user is
 * linked rather than duplicated (UserRepository.upsertByEmail dedups by email).
 */
async function resolveOAuthUser(ident: ResolvedIdentity, provider: string): Promise<string> {
  if (!ident.emailVerified) throw new Error('email not verified');
  const existing = await harness.identities.findByProvider(provider, ident.providerId);
  if (existing) return existing.userId;
  const user = await harness.users.upsertByEmail(ident.email.trim().toLowerCase());
  await harness.identities.link({ userId: user.id, provider, providerId: ident.providerId, email: user.email, createdAt: new Date().toISOString() });
  return user.id;
}

/** The owner's effective plan (entitlements), resolved from their subscription (fail-closed to free). */
async function entitlementsFor(ownerId: string): Promise<PlanDef> {
  return resolveEntitlements(await harness.subscriptions.get(ownerId), harness.plans());
}

/** Apply a verified billing webhook to the subscription store (idempotency handled by caller). */
async function applyWebhookEvent(ev: WebhookEvent): Promise<void> {
  const existing = await harness.subscriptions.get(ev.ownerId);
  const sub: Subscription = {
    ownerId: ev.ownerId,
    plan: ev.plan ?? existing?.plan ?? (ev.type === 'subscription.canceled' ? 'free' : 'pro'),
    status: ev.type === 'subscription.canceled' ? 'canceled' : (ev.status ?? 'active'),
    periodEnd: ev.periodEnd ?? existing?.periodEnd,
    providerRef: ev.providerRef ?? existing?.providerRef,
    updatedAt: new Date().toISOString(),
  };
  await harness.subscriptions.save(sub);
  await harness.audit.record({ id: randomUUID(), ownerId: ev.ownerId, taskId: 'billing', tool: 'billing', risk: 'low_write', decision: 'allow', status: 'executed', summary: `${ev.type} → ${sub.plan}/${sub.status}` });
}

/** Build http auth headers from PLAINTEXT secrets (used at connect-time, before encryption). */
function httpHeadersFromPlain(transport: string, secrets: Record<string, string>): Record<string, string> | undefined {
  if (transport !== 'http') return undefined;
  if (secrets.authorization) return { Authorization: secrets.authorization };
  if (secrets.token) return { Authorization: `Bearer ${secrets.token}` };
  return undefined;
}

interface ConnectorInput {
  name: string;
  transport: 'stub' | 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  readOnlyTools?: string[];
  secrets?: Record<string, string>;
}

/** Connect once to enumerate tools + infer risk, then persist the connector (secrets encrypted). */
async function createConnector(ownerId: string, input: ConnectorInput): Promise<Connector | { error: string }> {
  const plain = input.secrets ?? {};
  const server = {
    name: input.name || 'connector',
    transport: input.transport,
    command: input.command,
    args: Array.isArray(input.args) ? input.args : [],
    url: input.url,
    readOnlyTools: Array.isArray(input.readOnlyTools) ? input.readOnlyTools : [],
    headers: httpHeadersFromPlain(input.transport, plain),
    timeoutMs: 10_000,
  };
  let tools: Connector['tools'] = [];
  try {
    const session = await harness.mcpClientFor(input.transport).connect(server as never);
    const defs = await session.listTools();
    tools = defs.map((d) => ({ name: d.name, risk: inferRisk(d, server as never) }));
    await session.close();
  } catch (e) {
    return { error: `could not connect: ${e instanceof Error ? e.message : String(e)}` };
  }
  const secrets: Record<string, string> = {};
  for (const [k, v] of Object.entries(plain)) secrets[k] = encryptSecret(String(v));
  const connector: Connector = {
    id: randomUUID(),
    ownerId,
    name: server.name,
    transport: server.transport,
    command: server.command,
    args: server.args,
    url: server.url,
    readOnlyTools: server.readOnlyTools,
    disabledTools: [],
    enabled: true,
    tools,
    secrets,
  };
  await harness.connectors.save(connector);
  return connector;
}

/** Read-only health probe: connect + listTools, timed; never mutates. Decrypts secrets locally. */
async function probeConnector(c: Connector): Promise<{ ok: boolean; toolCount?: number; ms?: number; error?: string }> {
  const plain: Record<string, string> = {};
  for (const [k, v] of Object.entries(c.secrets)) {
    try { plain[k] = decryptSecret(v); } catch { /* skip unreadable secret */ }
  }
  const server = {
    name: c.name, transport: c.transport, command: c.command, args: c.args, url: c.url,
    readOnlyTools: c.readOnlyTools, headers: httpHeadersFromPlain(c.transport, plain), timeoutMs: 8000,
  };
  const start = Date.now();
  try {
    const session = await harness.mcpClientFor(c.transport).connect(server as never);
    const tools = await session.listTools();
    await session.close();
    return { ok: true, toolCount: tools.length, ms: Date.now() - start };
  } catch (e) {
    return { ok: false, ms: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Wrap each request in an `http.request` span (S17). The span context is active for the whole
 * handler, so orchestrator/job spans nest under it and jobs.start() auto-captures it as the parent
 * (cross-process propagation: web → worker). Inbound traceparent is intentionally NOT honored as a
 * parent — it is untrusted; correlation only.
 */
export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const tracer = harness?.tracer;
  if (!tracer) return handleInner(req, res);
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  const span = tracer.startSpan('http.request', { attributes: { 'http.method': req.method ?? 'GET', 'http.route': pathname } });
  try {
    await withSpanContext(span.spanContext(), () => handleInner(req, res));
    span.setStatus(res.statusCode >= 500 ? 'error' : 'ok');
  } catch (e) {
    span.setStatus('error', e instanceof Error ? e.message : String(e));
    throw e;
  } finally {
    span.end({ 'http.status_code': res.statusCode });
  }
}

async function handleInner(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const { pathname } = url;
  const method = req.method ?? 'GET';

  observe(req, res);
  applySecurityHeaders(res);
  if (applyCors(req, res)) return; // handled preflight

  // Operational metrics (aggregate numbers only — no secrets/PII). Unauthenticated by design.
  if (method === 'GET' && pathname === '/metrics') return json(res, 200, metrics.snapshot());

  // Billing webhook (S13): public, authenticated by provider signature over the RAW body + idempotent.
  if (method === 'POST' && pathname === '/api/billing/webhook') {
    const raw = await readRawBody(req);
    const sig = (req.headers['stripe-signature'] ?? req.headers['x-apolla-signature']) as string | undefined;
    const ev = harness.payment.parseWebhook(raw, sig);
    if (!ev) return json(res, 401, { error: 'invalid signature' });
    if (!(await harness.subscriptions.markEventProcessed(ev.id))) return json(res, 200, { ok: true, duplicate: true });
    await applyWebhookEvent(ev);
    return json(res, 200, { ok: true });
  }

  // Per-IP rate limit (protects login/register + overall). Fail-closed with 429 + Retry-After.
  const ip = clientIp(req);
  if (!limiters.ip().allow(ip)) {
    res.setHeader('Retry-After', String(limiters.ip().retryAfterSec(ip)));
    return json(res, 429, { error: 'rate limit exceeded' });
  }
  // Body size limit for write methods.
  if ((method === 'POST' || method === 'PUT' || method === 'PATCH') && Number(req.headers['content-length'] ?? 0) > MAX_BODY_BYTES) {
    return json(res, 413, { error: 'payload too large' });
  }

  if (method === 'GET' && pathname === '/') {
    if (sendSpaIndex(res)) return; // single-origin SPA when WEB_DIST is set
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(UI_HTML);
    return;
  }
  // SPA serving (public, before the auth gate): real assets (/assets/*, favicon) by path; any other
  // non-API/non-media GET → index.html so client-side routes (/billing, /research) deep-link.
  if (method === 'GET' && WEB_DIST) {
    const file = spaFile(pathname);
    if (file) return sendFile(res, file);
    if (!pathname.startsWith('/api/') && !pathname.startsWith('/media/') && sendSpaIndex(res)) return;
  }
  // GET /media/:key — serve re-hosted media (public; uris are unguessable enough for the demo).
  if (method === 'GET' && pathname.startsWith('/media/')) {
    const obj = harness.objectStore.read(pathname.slice('/media/'.length));
    if (!obj) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': obj.mime });
    res.end(obj.bytes);
    return;
  }

  if (method === 'GET' && pathname === '/api/health') {
    return json(res, 200, {
      ok: true,
      mode: harness.mode,
      persistence: harness.persistence,
      jobQueue: harness.jobQueue.inProcess ? 'in-process' : 'distributed',
      tracing: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ? 'otel' : 'noop',
      features: { auto_skill_write: harness.features.enabled('auto_skill_write') },
    });
  }

  // --- Auth ---
  // Register: email + password (scrypt-hashed; never stored/logged in plaintext).
  if (method === 'POST' && pathname === '/api/auth/register') {
    const body = await readBody(req);
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    if (!email.includes('@')) return json(res, 400, { error: 'valid email required' });
    if (password.length < 8) return json(res, 400, { error: 'password must be at least 8 characters' });
    try {
      const user = await harness.users.register(email, hashPassword(password));
      await startSession(res, harness.sessions, user.id);
      return json(res, 201, { id: user.id, email: user.email });
    } catch {
      return json(res, 409, { error: 'email already registered' });
    }
  }
  if (method === 'POST' && pathname === '/api/auth/login') {
    const body = await readBody(req);
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    if (!email.includes('@')) return json(res, 400, { error: 'valid email required' });
    if (PASSWORD_MODE || password) {
      // Verify against a stored credential. A non-existent user is rejected the same way as a wrong
      // password (no account enumeration), after a verify against a dummy hash to equalize timing.
      const cred = await harness.users.findCredentialByEmail(email);
      const ok = cred && verifyPassword(password, cred.passwordHash);
      if (!ok) {
        if (!cred) verifyPassword(password, hashPassword('x'));
        return json(res, 401, { error: 'invalid email or password' });
      }
      await startSession(res, harness.sessions, cred.user.id);
      return json(res, 200, { id: cred.user.id, email: cred.user.email });
    }
    // Demo mode, no password supplied: zero-config email-only login.
    const user = await harness.users.upsertByEmail(email);
    await startSession(res, harness.sessions, user.id);
    return json(res, 200, { id: user.id, email: user.email });
  }
  if (method === 'POST' && pathname === '/api/auth/logout') {
    await endSession(req, res, harness.sessions);
    return json(res, 200, { ok: true });
  }

  // OAuth/SSO (S14): public. start → state+PKCE → 302 to provider; callback → verify → link → session.
  const oauthStart = pathname.match(/^\/api\/auth\/oauth\/([^/]+)\/start$/);
  if (method === 'GET' && oauthStart) {
    const provider = oauthStart[1]!;
    const prov = harness.authProviders.get(provider);
    if (!prov) return json(res, 404, { error: 'unknown provider' });
    const next = url.searchParams.get('next') ?? '/';
    if (!isSafeRelativePath(next)) return json(res, 400, { error: 'invalid redirect' });
    const proto = (req.headers['x-forwarded-proto'] as string) ?? 'http';
    const redirectUri = `${proto}://${req.headers.host}/api/auth/oauth/${provider}/callback`;
    const state = newState();
    const { verifier, challenge } = newPkce();
    await harness.oauthStates.put(state, { provider, pkceVerifier: verifier, redirectUri, next, expiresAt: Date.now() + 10 * 60 * 1000 });
    res.statusCode = 302;
    res.setHeader('Location', prov.authorizeUrl({ state, pkceChallenge: challenge, redirectUri }));
    res.end();
    return;
  }
  const oauthCb = pathname.match(/^\/api\/auth\/oauth\/([^/]+)\/callback$/);
  if (method === 'GET' && oauthCb) {
    const provider = oauthCb[1]!;
    const prov = harness.authProviders.get(provider);
    if (!prov) return json(res, 404, { error: 'unknown provider' });
    const entry = await harness.oauthStates.consume(url.searchParams.get('state') ?? '');
    if (!entry || entry.provider !== provider) return json(res, 400, { error: 'invalid state' });
    let userId: string;
    try {
      const tokens = await prov.exchangeCode({ code: url.searchParams.get('code') ?? '', pkceVerifier: entry.pkceVerifier, redirectUri: entry.redirectUri });
      userId = await resolveOAuthUser(await prov.fetchIdentity(tokens), provider);
    } catch {
      return json(res, 401, { error: 'oauth sign-in failed' });
    }
    await startSession(res, harness.sessions, userId);
    await harness.audit.record({ id: randomUUID(), ownerId: userId, taskId: 'auth', tool: 'oauth', risk: 'low_write', decision: 'allow', status: 'executed', summary: `login via ${provider}` });
    res.statusCode = 302;
    res.setHeader('Location', entry.next ?? '/');
    res.end();
    return;
  }
  if (method === 'GET' && pathname === '/api/auth/providers') {
    return json(res, 200, { providers: [...harness.authProviders.keys()] });
  }

  // Everything below requires a session (browser) OR an API token (extension/CLI, S12).
  const ownerId = (await readSession(req, harness.sessions)) ?? (await readBearer(req, harness.apiTokens));
  if (method === 'GET' && pathname === '/api/auth/me') {
    if (!ownerId) return json(res, 401, { error: 'not authenticated' });
    const user = await harness.users.get(ownerId);
    if (!user) return json(res, 401, { error: 'not authenticated' });
    const identities = (await harness.identities.listByUser(ownerId)).map((i) => ({ provider: i.provider }));
    return json(res, 200, { ...user, identities });
  }
  if (!ownerId) return json(res, 401, { error: 'not authenticated' });
  (res as ObservedResponse).__ownerId = ownerId; // for the structured access log (id, not PII)

  // Strict per-owner limit on expensive (LLM/media) endpoints (S10-T3).
  if (isExpensive(method, pathname) && !limiters.owner().allow(ownerId)) {
    res.setHeader('Retry-After', String(limiters.owner().retryAfterSec(ownerId)));
    return json(res, 429, { error: 'rate limit exceeded — slow down' });
  }

  // --- MCP server (S18): Apolla's capabilities as MCP tools, JSON-RPC, API-token authed (via the
  // gate above → ownerId). Every tools/call is owner-scoped + quota-gated + rate-limited + audited;
  // the enclosing http.request span (S17) traces it, with orchestrator spans nesting underneath.
  if (method === 'POST' && pathname === '/api/mcp') {
    const rpc = (await readBody(req)) as unknown as JsonRpcRequest;
    if (rpc.method === 'tools/call') {
      if (!limiters.owner().allow(ownerId)) {
        res.setHeader('Retry-After', String(limiters.owner().retryAfterSec(ownerId)));
        return json(res, 200, { jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32000, message: 'rate limit exceeded' } });
      }
      const q = await harness.quota.check(ownerId);
      if (!q.ok) return json(res, 200, { jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32000, message: 'quota reached — upgrade your plan' } });
      const toolName = (rpc.params as { name?: string } | undefined)?.name ?? '';
      await harness.audit.record({ id: randomUUID(), ownerId, taskId: 'mcp', tool: `mcp:${toolName}`, risk: 'read', decision: 'allow', status: 'executed', summary: `mcp tools/call ${toolName}` });
    }
    mcpServer ??= new McpServer(buildCapabilityTools(harness));
    return json(res, 200, await mcpServer.handle(rpc, ownerId));
  }

  // --- API tokens (S12): cross-origin auth for the extension / CLI ---
  if (method === 'POST' && pathname === '/api/tokens') {
    const body = await readBody(req);
    const { id, secret, plaintext } = newApiToken();
    const name = String(body.name ?? '').slice(0, 80) || 'token';
    await harness.apiTokens.create({ id, ownerId, name, hashedToken: hashPassword(secret), createdAt: new Date().toISOString() });
    return json(res, 201, { id, name, token: plaintext }); // plaintext shown exactly once
  }
  if (method === 'GET' && pathname === '/api/tokens') {
    const list = await harness.apiTokens.list(ownerId);
    return json(res, 200, list.map((t) => ({ id: t.id, name: t.name, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt })));
  }
  const tokDelete = pathname.match(/^\/api\/tokens\/([^/]+)$/);
  if (method === 'DELETE' && tokDelete) {
    await harness.apiTokens.delete(ownerId, tokDelete[1]!);
    return json(res, 200, { ok: true });
  }

  // --- Billing (S13) ---
  if (method === 'POST' && pathname === '/api/billing/checkout') {
    const body = await readBody(req);
    const plan = String(body.plan ?? '');
    if (!harness.plans().some((p) => p.id === plan) || plan === 'free') return json(res, 400, { error: 'unknown plan' });
    const co = await harness.payment.createCheckout({ ownerId, plan });
    // Stub provider has no real callback — activate immediately so the offline demo works end-to-end.
    if (harness.payment.name === 'stub') {
      await applyWebhookEvent({ id: `local_${randomUUID()}`, type: 'subscription.created', ownerId, plan, status: 'active' });
    }
    return json(res, 200, { url: co.url, activated: harness.payment.name === 'stub' });
  }
  if (method === 'POST' && pathname === '/api/billing/cancel') {
    const sub = await harness.subscriptions.get(ownerId);
    await harness.payment.cancel(ownerId, sub?.providerRef);
    await applyWebhookEvent({ id: `local_${randomUUID()}`, type: 'subscription.canceled', ownerId });
    return json(res, 200, { ok: true });
  }
  if (method === 'GET' && pathname === '/api/billing/subscription') {
    const [sub, plan, usage] = await Promise.all([harness.subscriptions.get(ownerId), entitlementsFor(ownerId), harness.quota.check(ownerId)]);
    return json(res, 200, { subscription: sub ?? null, plan, usage, plans: harness.plans() });
  }

  // --- Projects ---
  if (method === 'POST' && pathname === '/api/projects') {
    const body = await readBody(req);
    const name = String(body.name ?? '').trim();
    if (!name) return json(res, 400, { error: 'name required' });
    const project = await harness.projects.create({
      id: randomUUID(),
      ownerId,
      name,
      description: String(body.description ?? ''),
    });
    return json(res, 201, project);
  }
  if (method === 'GET' && pathname === '/api/projects') {
    return json(res, 200, await harness.projects.list(ownerId));
  }

  // --- Memory / preferences ---
  if (method === 'GET' && pathname === '/api/memory/model') {
    return json(res, 200, (await harness.memory.getUserModel(ownerId)) ?? { ownerId, formats: [] });
  }
  if (method === 'POST' && pathname === '/api/memory/model') {
    const body = await readBody(req);
    return json(res, 200, await harness.memory.setUserModel(ownerId, body));
  }
  if (method === 'DELETE' && pathname === '/api/memory') {
    await harness.memory.clear(ownerId);
    return json(res, 200, { ok: true });
  }

  // --- Audit ---
  if (method === 'GET' && pathname === '/api/audit') {
    const taskId = url.searchParams.get('taskId') ?? undefined;
    return json(res, 200, await harness.audit.list(ownerId, taskId));
  }

  // --- Notifications ---
  if (method === 'GET' && pathname === '/api/notifications') {
    return json(res, 200, await harness.notifications.list(ownerId));
  }
  const notifRead = pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
  if (method === 'POST' && notifRead) {
    await harness.notifications.markRead(ownerId, notifRead[1]!);
    return json(res, 200, { ok: true });
  }

  // --- Plugins (Cowork §15.2): role-specific capability bundles ---
  if (method === 'GET' && pathname === '/api/plugins/official') {
    return json(res, 200, harness.officialPlugins());
  }
  if (method === 'GET' && pathname === '/api/plugins') {
    return json(res, 200, await harness.plugins.list(ownerId));
  }
  if (method === 'POST' && pathname === '/api/plugins/install') {
    const body = await readBody(req);
    const plugin = harness.officialPlugins().find((p) => p.name === String(body.name ?? ''));
    if (!plugin) return json(res, 404, { error: 'unknown plugin' });
    await harness.plugins.install(ownerId, plugin);
    // Flag any required connectors the owner has not connected yet (install still succeeds).
    const connected = new Set((await harness.connectors.list(ownerId)).map((c) => c.name));
    const missingConnectors = plugin.requiredConnectors.filter((rc) => !connected.has(rc));
    return json(res, 201, { plugin, missingConnectors });
  }
  const pluginDelete = pathname.match(/^\/api\/plugins\/([^/]+)$/);
  if (method === 'DELETE' && pluginDelete) {
    await harness.plugins.uninstall(ownerId, decodeURIComponent(pluginDelete[1]!));
    return json(res, 200, { ok: true });
  }

  // --- Cowork (S6): start an integrative sub-agent run as a background job ---
  if (method === 'POST' && pathname === '/api/cowork') {
    const body = await readBody(req);
    const goal = String(body.goal ?? '').trim();
    if (!goal) return json(res, 400, { error: 'goal is required' });
    if (!hasFeature(await entitlementsFor(ownerId), 'cowork')) return json(res, 402, { error: 'Cowork is a Pro feature — upgrade your plan', requiresPlan: 'pro' });
    const q = await harness.quota.check(ownerId);
    if (!q.ok) return json(res, 402, { error: 'quota reached — upgrade your plan', ...q });
    const { job } = await harness.jobs.start(ownerId, {
      kind: 'cowork',
      input: { goal, ...(Array.isArray(body.subgoals) ? { subgoals: body.subgoals } : {}) },
      allowTools: Array.isArray(body.allowTools) ? body.allowTools : [],
    });
    return json(res, 201, { jobId: job.id });
  }

  // --- Workspace (S7): versioned project files ---
  if (method === 'GET' && pathname === '/api/workspace') {
    const projectId = url.searchParams.get('projectId') || undefined;
    return json(res, 200, await harness.workspace.list(ownerId, { projectId }));
  }
  if (method === 'GET' && pathname === '/api/workspace/file') {
    const path = url.searchParams.get('path') || '';
    const projectId = url.searchParams.get('projectId') || undefined;
    const version = url.searchParams.get('version') ? Number(url.searchParams.get('version')) : undefined;
    try {
      const file = await harness.workspace.read(ownerId, path, { projectId, version });
      if (!file) return json(res, 404, { error: 'no such file' });
      if (url.searchParams.get('download')) {
        res.writeHead(200, { 'content-type': file.mime, 'content-disposition': `attachment; filename="${file.path.split('/').pop()}"` });
        return void res.end(file.content);
      }
      return json(res, 200, file);
    } catch (e) {
      return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (method === 'GET' && pathname === '/api/workspace/history') {
    const path = url.searchParams.get('path') || '';
    try {
      return json(res, 200, await harness.workspace.history(ownerId, path));
    } catch (e) {
      return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (method === 'POST' && pathname === '/api/workspace/save-artifact') {
    const body = await readBody(req);
    try {
      const file = await harness.workspace.write({ ownerId, projectId: body.projectId || undefined, path: String(body.path ?? ''), content: String(body.content ?? ''), mime: body.mime });
      return json(res, 201, file);
    } catch (e) {
      return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (method === 'POST' && pathname === '/api/workspace/rollback') {
    const body = await readBody(req);
    try {
      const file = await harness.workspace.rollback(ownerId, String(body.path ?? ''), Number(body.version), { projectId: body.projectId || undefined });
      return json(res, 200, file);
    } catch (e) {
      return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (method === 'POST' && pathname === '/api/writer') {
    const body = await readBody(req);
    const path = String(body.path ?? '');
    const instruction = String(body.instruction ?? '');
    if (!path || !instruction) return json(res, 400, { error: 'path and instruction are required' });
    let result: { path: string; version: number } | undefined;
    let error: string | undefined;
    for await (const e of harness.writer.run({ ownerId, projectId: body.projectId || undefined, path, instruction })) {
      if (e.type === 'written') result = { path: e.path, version: e.version };
      else if (e.type === 'error') error = e.message;
    }
    if (error || !result) return json(res, 400, { error: error ?? 'writer failed' });
    return json(res, 200, result);
  }

  // --- Text product surfaces (S8): translate / sheet / notes ---
  if (method === 'GET' && pathname === '/api/surfaces') {
    return json(res, 200, harness.officialSurfaces());
  }
  if (method === 'POST' && pathname === '/api/surface') {
    const body = await readBody(req);
    const surface = harness.officialSurfaces().find((s) => s.id === String(body.surfaceId ?? ''));
    if (!surface) return json(res, 404, { error: 'unknown surface' });
    const params = (body.params ?? {}) as Record<string, unknown>;
    let outputPath = String(body.outputPath ?? '').trim();
    if (!outputPath) {
      if (surface.inputKind === 'doc' && body.sourcePath) {
        const src = String(body.sourcePath);
        if (surface.id === 'translate') {
          const dot = src.lastIndexOf('.');
          const tag = String(params.targetLang ?? 'out').toLowerCase().slice(0, 5);
          outputPath = dot > 0 ? `${src.slice(0, dot)}.${tag}${src.slice(dot)}` : `${src}.${tag}`;
        } else {
          outputPath = src; // in-place edit → new version (e.g. sheet add-column)
        }
      } else {
        outputPath = `surface-${surface.id}.md`;
      }
    }
    let result: { path: string; version: number } | undefined;
    let structured: unknown;
    let error: string | undefined;
    for await (const e of harness.surfaces.run({ ownerId, projectId: body.projectId || undefined, surface, text: body.text, sourcePath: body.sourcePath, params, outputPath })) {
      if (e.type === 'written') result = { path: e.path, version: e.version };
      else if (e.type === 'structured') structured = e.data;
      else if (e.type === 'error') error = e.message;
    }
    if (error || !result) return json(res, 400, { error: error ?? 'surface failed' });
    return json(res, 200, { ...result, structured });
  }

  // --- Scheduled tasks ---
  if (method === 'POST' && pathname === '/api/schedules') {
    const body = await readBody(req);
    const cron = String(body.cron ?? '').trim();
    const kind = String(body.kind ?? '');
    if (!cron || !['research', 'agent', 'skill', 'media', 'cowork'].includes(kind)) {
      return json(res, 400, { error: 'cron and a valid kind are required' });
    }
    let next: string | undefined;
    try {
      next = nextRun(cron, new Date())?.toISOString();
    } catch (e) {
      return json(res, 400, { error: `invalid cron: ${e instanceof Error ? e.message : String(e)}` });
    }
    const task = await harness.scheduleRepo.save({
      id: randomUUID(),
      ownerId,
      name: String(body.name ?? ''),
      cron,
      jobSpec: { kind: kind as never, input: (body.input ?? {}) as Record<string, unknown>, allowTools: Array.isArray(body.allowTools) ? body.allowTools : [] },
      enabled: true,
      nextRunAt: next,
    });
    return json(res, 201, task);
  }
  if (method === 'GET' && pathname === '/api/schedules') {
    return json(res, 200, await harness.scheduleRepo.list(ownerId));
  }
  const schedToggle = pathname.match(/^\/api\/schedules\/([^/]+)\/toggle$/);
  if (method === 'POST' && schedToggle) {
    const t = await harness.scheduleRepo.get(schedToggle[1]!);
    if (!t || t.ownerId !== ownerId) return json(res, 404, { error: 'unknown schedule' });
    const body = await readBody(req);
    const saved = await harness.scheduleRepo.save({ ...t, enabled: body.enabled !== false });
    return json(res, 200, saved);
  }
  const schedRunNow = pathname.match(/^\/api\/schedules\/([^/]+)\/run-now$/);
  if (method === 'POST' && schedRunNow) {
    const t = await harness.scheduleRepo.get(schedRunNow[1]!);
    if (!t || t.ownerId !== ownerId) return json(res, 404, { error: 'unknown schedule' });
    const { job } = await harness.jobs.start(ownerId, t.jobSpec, { scheduledTaskId: t.id });
    return json(res, 201, { jobId: job.id });
  }
  const schedDelete = pathname.match(/^\/api\/schedules\/([^/]+)$/);
  if (method === 'DELETE' && schedDelete) {
    await harness.scheduleRepo.delete(ownerId, schedDelete[1]!);
    return json(res, 200, { ok: true });
  }

  // --- Background jobs ---
  if (method === 'POST' && pathname === '/api/jobs') {
    const body = await readBody(req);
    const kind = String(body.kind ?? '');
    if (!['research', 'agent', 'skill', 'media', 'cowork'].includes(kind)) return json(res, 400, { error: 'invalid job kind' });
    const q = await harness.quota.check(ownerId);
    if (!q.ok) return json(res, 402, { error: 'quota reached — upgrade your plan', ...q });
    const { job } = await harness.jobs.start(ownerId, {
      kind: kind as never,
      input: (body.input ?? {}) as Record<string, unknown>,
      allowTools: Array.isArray(body.allowTools) ? body.allowTools : [],
    });
    return json(res, 201, { jobId: job.id });
  }
  if (method === 'GET' && pathname === '/api/jobs') {
    return json(res, 200, await harness.jobRepo.list(ownerId));
  }
  const jobEvents = pathname.match(/^\/api\/jobs\/([^/]+)\/events$/);
  if (method === 'GET' && jobEvents) {
    const jobId = jobEvents[1]!;
    const job0 = await harness.jobRepo.get(jobId);
    if (!job0 || job0.ownerId !== ownerId) return json(res, 404, { error: 'unknown job' });
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    let sent = 0;
    for (;;) {
      const evs = await harness.jobRepo.events(jobId);
      for (; sent < evs.length; sent++) res.write(`data: ${JSON.stringify(evs[sent])}\n\n`);
      const job = await harness.jobRepo.get(jobId);
      if (!job || job.status === 'done' || job.status === 'failed') {
        res.write(`data: ${JSON.stringify({ type: 'job-status', status: job?.status ?? 'failed' })}\n\n`);
        break;
      }
      await sleep(300);
    }
    res.end();
    return;
  }
  const jobOne = pathname.match(/^\/api\/jobs\/([^/]+)$/);
  if (method === 'GET' && jobOne) {
    const job = await harness.jobRepo.get(jobOne[1]!);
    return job && job.ownerId === ownerId ? json(res, 200, job) : json(res, 404, { error: 'unknown job' });
  }

  // --- Agent (multi-tool, tiered confirmation) ---
  if (method === 'POST' && pathname === '/api/agent') {
    const body = await readBody(req);
    const goal = String(body.goal ?? '').trim();
    if (!goal) return json(res, 400, { error: 'goal required' });
    const agentId = randomUUID();
    harness.pendingAgents.set(agentId, { goal, ownerId });
    return json(res, 201, { agentId });
  }
  if (method === 'POST' && pathname.match(/^\/api\/agent\/[^/]+\/confirm$/)) {
    const id = pathname.split('/')[3]!;
    const body = await readBody(req);
    const pending = harness.pendingAgents.get(id);
    if (!pending || pending.ownerId !== ownerId) return json(res, 404, { error: 'no pending confirmation' });
    const waiter = harness.confirmMailbox.get(id);
    if (!waiter) return json(res, 404, { error: 'no pending confirmation' });
    waiter(body.approved === true);
    harness.confirmMailbox.delete(id);
    return json(res, 200, { ok: true });
  }
  const agentEvents = pathname.match(/^\/api\/agent\/([^/]+)\/events$/);
  if (method === 'GET' && agentEvents) {
    const agentId = agentEvents[1]!;
    const input = harness.pendingAgents.get(agentId);
    if (!input || input.ownerId !== ownerId) return json(res, 404, { error: 'unknown agent task' });
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const tools = await harness.agentToolsFor(ownerId);
    const agent = new AgentOrchestrator({
      router: harness.llmRouter,
      tools,
      prompts: harness.prompts,
      audit: (entry) => harness.audit.record(entry),
    });
    // Confirmation: pause until POST /api/agent/:id/confirm arrives (or 60s timeout → deny).
    const approve = (): Promise<boolean> =>
      new Promise((resolve) => {
        const t = setTimeout(() => {
          harness.confirmMailbox.delete(agentId);
          resolve(false);
        }, 60_000);
        harness.confirmMailbox.set(agentId, (ok) => {
          clearTimeout(t);
          resolve(ok);
        });
      });
    try {
      for await (const ev of agent.run({ ownerId, goal: input.goal, taskId: agentId, approve })) {
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
      }
    } catch (e) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: e instanceof Error ? e.message : String(e) })}\n\n`);
    }
    res.end();
    return;
  }

  // --- Connectors (MCP) ---
  // Marketplace catalog (S11-T3): browse + one-click add.
  if (method === 'GET' && pathname === '/api/connectors/catalog') {
    return json(res, 200, harness.connectorCatalog());
  }
  if (method === 'POST' && pathname === '/api/connectors/from-catalog') {
    const body = await readBody(req);
    const entry = harness.connectorCatalog().find((e) => e.id === String(body.id ?? ''));
    if (!entry) return json(res, 404, { error: 'unknown catalog entry' });
    const secrets = (body.secrets ?? {}) as Record<string, string>;
    const missing = entry.requiredSecrets.filter((s) => !secrets[s]);
    if (missing.length) return json(res, 400, { error: `missing required secrets: ${missing.join(', ')}` });
    const result = await createConnector(ownerId, {
      name: String(body.name ?? '') || entry.name,
      transport: entry.transport,
      command: body.command,
      url: body.url || entry.url,
      readOnlyTools: entry.readOnlyTools,
      secrets,
    });
    if ('error' in result) return json(res, 400, result);
    return json(res, 201, { ...result, secrets: Object.keys(result.secrets) });
  }
  if (method === 'POST' && pathname === '/api/connectors') {
    const body = await readBody(req);
    const result = await createConnector(ownerId, {
      name: String(body.name ?? ''),
      transport: String(body.transport ?? 'stub') as 'stub' | 'stdio' | 'http',
      command: body.command,
      args: body.args,
      url: body.url,
      readOnlyTools: body.readOnlyTools,
      secrets: body.secrets,
    });
    if ('error' in result) return json(res, 400, result);
    return json(res, 201, { ...result, secrets: Object.keys(result.secrets) });
  }
  if (method === 'GET' && pathname === '/api/connectors') {
    const list = await harness.connectors.list(ownerId);
    return json(res, 200, list.map((c) => ({ ...c, secrets: Object.keys(c.secrets) })));
  }
  const connHealth = pathname.match(/^\/api\/connectors\/([^/]+)\/health$/);
  if (method === 'GET' && connHealth) {
    const c = await harness.connectors.get(connHealth[1]!);
    if (!c || c.ownerId !== ownerId) return json(res, 404, { error: 'unknown connector' });
    const h = await probeConnector(c);
    metrics.inc(`connector.health.${h.ok ? 'ok' : 'fail'}`);
    return json(res, 200, h);
  }
  const connToggle = pathname.match(/^\/api\/connectors\/([^/]+)\/tool$/);
  if (method === 'POST' && connToggle) {
    const c = await harness.connectors.get(connToggle[1]!);
    if (!c || c.ownerId !== ownerId) return json(res, 404, { error: 'unknown connector' });
    const body = await readBody(req);
    const tool = String(body.tool ?? '');
    const enabled = body.enabled !== false;
    const disabled = new Set(c.disabledTools);
    if (enabled) disabled.delete(tool);
    else disabled.add(tool);
    await harness.connectors.save({ ...c, disabledTools: [...disabled] });
    return json(res, 200, { ok: true, disabledTools: [...disabled] });
  }
  const connDelete = pathname.match(/^\/api\/connectors\/([^/]+)$/);
  if (method === 'DELETE' && connDelete) {
    await harness.connectors.delete(ownerId, connDelete[1]!);
    return json(res, 200, { ok: true });
  }

  // --- Media ---
  if (method === 'POST' && pathname === '/api/media') {
    if (!hasFeature(await entitlementsFor(ownerId), 'media')) return json(res, 402, { error: 'Media generation is a Pro feature — upgrade your plan', requiresPlan: 'pro' });
    const body = await readBody(req);
    const alias = String(body.alias ?? '');
    const prompt = String(body.prompt ?? '').trim();
    const kind = alias.startsWith('video') ? 'video' : 'image';
    if (!prompt) return json(res, 400, { error: 'prompt required' });
    if (!['image_fast', 'image_premium', 'video_standard', 'video_premium'].includes(alias)) {
      return json(res, 400, { error: 'invalid media alias' });
    }
    const q = await harness.quota.check(ownerId);
    if (!q.ok) return json(res, 402, { error: 'quota reached — upgrade your plan', ...q });
    const estimateUsd = harness.mediaRouter.estimateCost(alias as never, { kind: kind as never, prompt, params: {} }).usd;
    // High-cost (video) requires explicit confirmation before we stage the run (PRD §13 / S3-T7).
    if (kind === 'video' && !body.confirm) {
      return json(res, 200, { requiresConfirmation: true, estimateUsd });
    }
    const mediaId = randomUUID();
    harness.pendingMedia.set(mediaId, { alias, kind, prompt, ownerId, projectId: body.projectId });
    return json(res, 201, { mediaId, estimateUsd });
  }
  if (method === 'GET' && pathname === '/api/media') {
    return json(res, 200, await harness.mediaRepo.list(ownerId));
  }
  const mediaEvents = pathname.match(/^\/api\/media\/([^/]+)\/events$/);
  if (method === 'GET' && mediaEvents) {
    const mediaId = mediaEvents[1]!;
    const input = harness.pendingMedia.get(mediaId);
    if (!input || input.ownerId !== ownerId) return json(res, 404, { error: 'unknown media task' });
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    try {
      for await (const ev of harness.mediaOrch.run({
        ownerId,
        alias: input.alias as never,
        job: { kind: input.kind as never, prompt: input.prompt, params: {} },
        taskId: mediaId,
        projectId: input.projectId,
        sourceTaskId: input.sourceTaskId,
      })) {
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
      }
    } catch (e) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: e instanceof Error ? e.message : String(e) })}\n\n`);
    }
    res.end();
    return;
  }

  // --- Skills ---
  if (method === 'GET' && pathname === '/api/skills') {
    return json(res, 200, await harness.skills.list(ownerId));
  }
  if (method === 'DELETE' && pathname.startsWith('/api/skills/')) {
    const name = decodeURIComponent(pathname.slice('/api/skills/'.length));
    await harness.skillRepo.delete(ownerId, name);
    return json(res, 200, { ok: true });
  }
  if (method === 'POST' && pathname === '/api/skills/run') {
    // Stage a skill rerun as a task (streamed via /api/tasks/:id/events).
    const body = await readBody(req);
    const skill = await harness.skills.get(String(body.name ?? ''), ownerId);
    if (!skill) return json(res, 404, { error: 'unknown skill' });
    const question = String(body.question ?? '').trim();
    if (!question) return json(res, 400, { error: 'question required' });
    const taskId = randomUUID();
    harness.pending.set(taskId, { question, ownerId, skillName: skill.name });
    return json(res, 201, { taskId });
  }

  // Research → media chaining (S3-T9): stage a media task using the research question as the prompt.
  const taskMedia = pathname.match(/^\/api\/tasks\/([^/]+)\/media$/);
  if (method === 'POST' && taskMedia) {
    if (!hasFeature(await entitlementsFor(ownerId), 'media')) return json(res, 402, { error: 'Media generation is a Pro feature — upgrade your plan', requiresPlan: 'pro' });
    const task = await harness.repo.get(taskMedia[1]!);
    if (!task || task.ownerId !== ownerId) return json(res, 404, { error: 'unknown task' });
    const body = await readBody(req);
    const alias = String(body.alias ?? 'image_premium');
    const kind = alias.startsWith('video') ? 'video' : 'image';
    const q = await harness.quota.check(ownerId);
    if (!q.ok) return json(res, 402, { error: 'quota reached — upgrade your plan', ...q });
    const estimateUsd = harness.mediaRouter.estimateCost(alias as never, { kind: kind as never, prompt: '', params: {} }).usd;
    if (kind === 'video' && !body.confirm) return json(res, 200, { requiresConfirmation: true, estimateUsd });
    const mediaId = randomUUID();
    const prompt = `${kind === 'video' ? 'A short explainer video' : 'A cover image'} for: ${task.question ?? 'the research report'}`;
    harness.pendingMedia.set(mediaId, { alias, kind, prompt, ownerId, projectId: task.projectId, sourceTaskId: task.id });
    return json(res, 201, { mediaId, estimateUsd });
  }

  const saveSkill = pathname.match(/^\/api\/tasks\/([^/]+)\/save-as-skill$/);
  if (method === 'POST' && saveSkill) {
    const task = await harness.repo.get(saveSkill[1]!);
    if (!task || task.ownerId !== ownerId) return json(res, 404, { error: 'unknown task' });
    if (!harness.features.enabled('auto_skill_write')) {
      return json(res, 403, { error: 'auto_skill_write is not available for the current model tier' });
    }
    const draft = autoDraftSkill(task);
    if (!draft) return json(res, 400, { error: 'task is not a completed research task' });
    const saved = await harness.skillRepo.save(ownerId, draft);
    return json(res, 201, saved);
  }

  // --- Tasks ---
  if (method === 'POST' && pathname === '/api/tasks') {
    const body = await readBody(req);
    const question = String(body.question ?? '').trim();
    if (!question) return json(res, 400, { error: 'question is required' });
    const q = await harness.quota.check(ownerId);
    if (!q.ok) {
      return json(res, 402, { error: 'task quota reached — upgrade your plan', used: q.used, limit: q.limit, plan: q.plan });
    }
    const taskId = randomUUID();
    harness.pending.set(taskId, { question, ownerId, projectId: body.projectId });
    // Static pre-run cost estimate for a research task (high-cost task hint, PRD §6.8).
    return json(res, 201, { taskId, estimatedCostUsd: 0.002, quota: q });
  }

  const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)(\/events|\/export)?$/);
  if (taskMatch) {
    const taskId = taskMatch[1]!;
    const sub = taskMatch[2];

    if (method === 'GET' && sub === '/events') {
      const input = harness.pending.get(taskId);
      if (!input || input.ownerId !== ownerId) return json(res, 404, { error: 'unknown task' });
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      try {
        const systemAddendum = await projectContext(input.projectId, ownerId);
        const skill = input.skillName ? await harness.skills.get(input.skillName, ownerId) : undefined;
        const stream = skill
          ? harness.skills.run(skill, { ownerId, question: input.question, taskId, projectId: input.projectId })
          : harness.orchestrator.run({ ownerId, question: input.question, taskId, projectId: input.projectId, systemAddendum });
        for await (const ev of stream) {
          res.write(`data: ${JSON.stringify(ev)}\n\n`);
        }
      } catch (e) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: e instanceof Error ? e.message : String(e) })}\n\n`);
      }
      res.end();
      return;
    }

    if (method === 'GET' && sub === '/export') {
      const task = await harness.repo.get(taskId);
      if (!task || task.ownerId !== ownerId) return json(res, 404, { error: 'no artifact' });
      const artifact = task.artifacts[0];
      if (!artifact) return json(res, 404, { error: 'no artifact' });
      // Embed any media generated for this research task (research→media, S3-T9).
      const media = (await harness.mediaRepo.list(ownerId)).filter((m) => m.sourceTaskId === taskId && m.status === 'ready');
      const assets = media.flatMap((m) => m.assets);
      const embedded = assets.length ? { ...artifact, content: embedMedia(artifact.content ?? '', assets) } : artifact;
      const fmt = url.searchParams.get('fmt') === 'html' ? 'html' : 'markdown';
      const file = exportArtifact(embedded, fmt);
      res.writeHead(200, {
        'content-type': file.mime,
        'content-disposition': `attachment; filename="${file.filename}"`,
      });
      res.end(file.content);
      return;
    }

    if (method === 'GET' && !sub) {
      const task = await harness.repo.get(taskId);
      return task && task.ownerId === ownerId ? json(res, 200, task) : json(res, 404, { error: 'unknown task' });
    }
  }

  json(res, 404, { error: 'not found' });
}

// Entry point — skipped under vitest so tests can import { handle, setHarness } without listening.
if (!process.env.VITEST) {
  const built = await buildHarness();
  setHarness(built);
  // In distributed mode (Redis queue) the standalone worker owns reconciliation + scheduling; the
  // web only enqueues. In-process mode keeps doing both here (S16).
  const ownsExecution = built.jobQueue.inProcess;
  if (ownsExecution) {
    // Startup reconciliation: any job still queued/running from a previous process is dead (S10-T6).
    const reconciled = await reconcileJobs(built.jobRepo).catch(() => 0);
    if (reconciled) console.log(`Reconciled ${reconciled} interrupted job(s) from a prior run`);
  }

  const PORT = Number(process.env.PORT ?? 3000);
  const server = createServer((req, res) => {
    handle(req, res).catch((e) => json(res, 500, { error: e instanceof Error ? e.message : String(e) }));
  }).listen(PORT, () => {
    console.log(`Apolla BFF [${built.mode}/${built.persistence}] → http://localhost:${PORT}`);
  });

  // In-process cron tick (S5-T3). Distributed mode: the worker owns scheduling (single point — no
  // double-ticking across web instances), so the web does not tick.
  const cron = ownsExecution
    ? setInterval(() => {
        built.scheduler.tick(new Date()).catch(() => {});
      }, 30_000)
    : undefined;

  // Graceful shutdown: stop accepting, stop the cron, close DB pool, exit.
  const shutdown = () => {
    if (cron) clearInterval(cron);
    server.close(() => {
      void built.tracer.shutdown().catch(() => {}).then(() => built.close?.()).finally(() => process.exit(0)); // flush pending spans
    });
    setTimeout(() => process.exit(0), 5000).unref(); // hard cap if connections linger
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
