import type { Plugin, Surface, ConnectorCatalogEntry, PlanDef, Subscription } from '@apolla/contracts';

export interface BillingInfo {
  subscription: Subscription | null;
  plan: PlanDef;
  usage: { used: number; limit: number; plan: string };
  plans: PlanDef[];
}

/** Thrown on any non-2xx response; carries the BFF's error message + status. */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

const BASE = (import.meta.env?.VITE_API_BASE as string | undefined) ?? '';

async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'include',
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, detail.error ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export interface User { id: string; email: string; identities?: { provider: string }[]; mfaEnabled?: boolean; isAdmin?: boolean }
export interface AdminStats { users: number; projects: number; tasks: number; jobs: Record<string, number>; subscriptions: Record<string, number> }
export interface AdminUserRow { id: string; email: string; createdAt: string; plan: string | null; projects: number }
export interface AdminAuditRow { id: string; ownerId: string; tool: string; risk: string; decision: string; status: string; summary: string; createdAt: string }
export type LoginResult = User | { mfaRequired: true; pendingToken: string };
export interface MfaEnrollment { secret: string; otpauthUri: string; recoveryCodes: string[] }
export const isMfaRequired = (r: LoginResult): r is { mfaRequired: true; pendingToken: string } => 'mfaRequired' in r;
export interface Project { id: string; name: string; description?: string }
export interface WorkspaceEntry { path: string; mime: string; version: number; size: number }
export interface WorkspaceFile { path: string; mime: string; version: number; size: number; content: string }
export interface Connector { id: string; name: string; transport: string; enabled: boolean; tools: { name: string; risk: string }[] }
export interface ScheduledTask { id: string; name: string; cron: string; enabled: boolean; jobSpec: { kind: string } }
export interface Job { id: string; kind: string; status: string; error?: string }
export interface Notification { id: string; title: string; read: boolean; kind: string }
export interface AuditEntry { tool: string; decision: string; status: string; confirmed?: boolean }

/** Typed client over the BFF HTTP API. SSE endpoints are exposed as URLs (consumed via useSSE). */
export const api = {
  base: BASE,
  // auth
  me: () => http<User>('GET', '/api/auth/me'),
  login: (email: string, password?: string) => http<LoginResult>('POST', '/api/auth/login', password ? { email, password } : { email }),
  mfaLogin: (pendingToken: string, code: string) => http<User>('POST', '/api/auth/mfa/login', { pendingToken, code }),
  mfaEnroll: () => http<MfaEnrollment>('POST', '/api/auth/mfa/enroll', {}),
  mfaVerify: (code: string) => http<{ mfaEnabled: boolean }>('POST', '/api/auth/mfa/verify', { code }),
  mfaDisable: (code: string) => http<{ mfaEnabled: boolean }>('POST', '/api/auth/mfa/disable', { code }),
  magicLinkRequest: (email: string) => http<{ ok: boolean }>('POST', '/api/auth/magic-link/request', { email }),
  magicLinkVerify: (token: string) => http<User>('POST', '/api/auth/magic-link/verify', { token }),
  register: (email: string, password: string) => http<User>('POST', '/api/auth/register', { email, password }),
  logout: () => http<void>('POST', '/api/auth/logout'),
  authProviders: () => http<{ providers: string[] }>('GET', '/api/auth/providers'),
  mcpManifest: () => http<{ endpoint: string; protocol: string; tools: { name: string; description: string }[] }>('GET', '/api/mcp/manifest'),
  oauthStartUrl: (provider: string, next = '/') => `${BASE}/api/auth/oauth/${provider}/start?next=${encodeURIComponent(next)}`,
  health: () => http<{ mode: string; persistence: string }>('GET', '/api/health'),
  // projects + memory
  projects: () => http<Project[]>('GET', '/api/projects'),
  createProject: (name: string, description = '') => http<Project>('POST', '/api/projects', { name, description }),
  // API tokens (for the browser extension / CLI)
  tokens: () => http<{ id: string; name: string; createdAt?: string; lastUsedAt?: string }[]>('GET', '/api/tokens'),
  createToken: (name: string) => http<{ id: string; name: string; token: string }>('POST', '/api/tokens', { name }),
  deleteToken: (id: string) => http<void>('DELETE', `/api/tokens/${id}`),
  // billing
  billing: () => http<BillingInfo>('GET', '/api/billing/subscription'),
  checkout: (plan: string) => http<{ url: string; activated: boolean }>('POST', '/api/billing/checkout', { plan }),
  cancelBilling: () => http<void>('POST', '/api/billing/cancel', {}),
  // release info (S24)
  version: () => http<{ version: string; mode: string; persistence: string }>('GET', '/api/version'),
  // operator console (S23)
  adminStats: () => http<AdminStats>('GET', '/api/admin/stats'),
  adminAudit: (limit = 50) => http<AdminAuditRow[]>('GET', `/api/admin/audit?limit=${limit}`),
  adminUsers: (limit = 100) => http<AdminUserRow[]>('GET', `/api/admin/users?limit=${limit}`),
  adminSetPlan: (id: string, plan: string) => http<{ ok: boolean; plan: string }>('POST', `/api/admin/users/${encodeURIComponent(id)}/plan`, { plan }),
  // account data lifecycle (S22)
  accountExport: () => http<Record<string, unknown>>('GET', '/api/account/export'),
  accountDelete: (confirm: string) => http<{ deleted: boolean }>('POST', '/api/account/delete', { confirm }),
  accountImport: (bundle: unknown) => http<{ projects: number; skills: number; workspace: number }>('POST', '/api/account/import', { bundle }),
  // collab (S21)
  collabGet: (docId: string, since = 0) => http<{ docId: string; ownerId: string; text: string; seq: number; ops: unknown[]; participants: string[] }>('GET', `/api/collab/${encodeURIComponent(docId)}?since=${since}`),
  collabPushOps: (docId: string, ops: unknown[]) => http<{ seq: number }>('POST', `/api/collab/${encodeURIComponent(docId)}/ops`, { ops }),
  collabShare: (docId: string) => http<{ token: string; link: string }>('POST', `/api/collab/${encodeURIComponent(docId)}/share`, {}),
  collabAccept: (token: string) => http<{ docId: string }>('POST', '/api/collab/share/accept', { token }),
  collabEventsUrl: (docId: string, since = 0) => `${BASE}/api/collab/${encodeURIComponent(docId)}/events?since=${since}`,
  // speech (S19)
  transcribe: (audio: string, mime: string) => http<{ text: string }>('POST', '/api/speech/transcribe', { audio, mime }),
  synthesize: (text: string, voice?: string) => http<{ uri: string }>('POST', '/api/speech/synthesize', { text, voice }),
  getMemoryModel: () => http<Record<string, unknown>>('GET', '/api/memory/model'),
  setMemoryModel: (m: { language?: string; style?: string }) => http<void>('POST', '/api/memory/model', m),
  clearMemory: () => http<void>('DELETE', '/api/memory'),
  // research / tasks
  createTask: (question: string, projectId?: string) => http<{ taskId: string }>('POST', '/api/tasks', { question, projectId }),
  taskEventsUrl: (taskId: string) => `${BASE}/api/tasks/${taskId}/events`,
  exportUrl: (taskId: string, fmt: 'md' | 'html') => `${BASE}/api/tasks/${taskId}/export?fmt=${fmt}`,
  saveAsSkill: (taskId: string) => http<{ name: string }>('POST', `/api/tasks/${taskId}/save-as-skill`),
  taskMedia: (taskId: string, alias: string, confirm: boolean) =>
    http<{ mediaId?: string; requiresConfirmation?: boolean; estimateUsd?: number }>('POST', `/api/tasks/${taskId}/media`, { alias, confirm }),
  mediaEventsUrl: (mediaId: string) => `${BASE}/api/media/${mediaId}/events`,
  // skills
  skills: () => http<{ name: string }[]>('GET', '/api/skills'),
  runSkill: (name: string, question: string) => http<{ taskId: string }>('POST', '/api/skills/run', { name, question }),
  // workspace
  workspace: () => http<WorkspaceEntry[]>('GET', '/api/workspace'),
  workspaceFile: (path: string, version?: number) =>
    http<WorkspaceFile>('GET', `/api/workspace/file?path=${encodeURIComponent(path)}${version ? `&version=${version}` : ''}`),
  workspaceHistory: (path: string) => http<WorkspaceFile[]>('GET', `/api/workspace/history?path=${encodeURIComponent(path)}`),
  workspaceDownloadUrl: (path: string, version?: number) =>
    `${BASE}/api/workspace/file?path=${encodeURIComponent(path)}${version ? `&version=${version}` : ''}&download=1`,
  saveArtifact: (path: string, content: string, mime?: string) => http<WorkspaceFile>('POST', '/api/workspace/save-artifact', { path, content, mime }),
  rollback: (path: string, version: number) => http<WorkspaceFile>('POST', '/api/workspace/rollback', { path, version }),
  writer: (path: string, instruction: string) => http<{ path: string; version: number }>('POST', '/api/writer', { path, instruction }),
  // surfaces
  surfaces: () => http<Surface[]>('GET', '/api/surfaces'),
  runSurface: (body: { surfaceId: string; text?: string; sourcePath?: string; params?: Record<string, unknown>; outputPath?: string }) =>
    http<{ path: string; version: number; structured?: unknown }>('POST', '/api/surface', body),
  // plugins + cowork
  officialPlugins: () => http<Plugin[]>('GET', '/api/plugins/official'),
  installedPlugins: () => http<Plugin[]>('GET', '/api/plugins'),
  installPlugin: (name: string) => http<{ plugin: Plugin; missingConnectors: string[] }>('POST', '/api/plugins/install', { name }),
  uninstallPlugin: (name: string) => http<void>('DELETE', `/api/plugins/${encodeURIComponent(name)}`),
  runCowork: (goal: string, allowTools: string[] = []) => http<{ jobId: string }>('POST', '/api/cowork', { goal, allowTools }),
  // agent
  runAgent: (goal: string) => http<{ agentId: string }>('POST', '/api/agent', { goal }),
  confirmAgent: (agentId: string, approved: boolean) => http<void>('POST', `/api/agent/${agentId}/confirm`, { approved }),
  agentEventsUrl: (agentId: string) => `${BASE}/api/agent/${agentId}/events`,
  audit: (taskId?: string) => http<AuditEntry[]>('GET', `/api/audit${taskId ? `?taskId=${encodeURIComponent(taskId)}` : ''}`),
  // connectors
  connectors: () => http<Connector[]>('GET', '/api/connectors'),
  addStubConnector: () => http<Connector>('POST', '/api/connectors', { name: 'demo', transport: 'stub', readOnlyTools: ['echo'] }),
  connectorCatalog: () => http<ConnectorCatalogEntry[]>('GET', '/api/connectors/catalog'),
  installFromCatalog: (id: string, url: string, secrets: Record<string, string>) =>
    http<Connector>('POST', '/api/connectors/from-catalog', { id, url, secrets }),
  connectorHealth: (id: string) => http<{ ok: boolean; toolCount?: number; ms?: number; error?: string }>('GET', `/api/connectors/${id}/health`),
  toggleConnector: (id: string, enabled: boolean) => http<Connector>('POST', `/api/connectors/${id}/toggle`, { enabled }),
  deleteConnector: (id: string) => http<void>('DELETE', `/api/connectors/${id}`),
  // automation
  schedules: () => http<ScheduledTask[]>('GET', '/api/schedules'),
  createSchedule: (body: { name: string; cron: string; kind: string; input: Record<string, unknown> }) => http<ScheduledTask>('POST', '/api/schedules', body),
  toggleSchedule: (id: string, enabled: boolean) => http<ScheduledTask>('POST', `/api/schedules/${id}/toggle`, { enabled }),
  runSchedule: (id: string) => http<{ jobId: string }>('POST', `/api/schedules/${id}/run-now`),
  deleteSchedule: (id: string) => http<void>('DELETE', `/api/schedules/${id}`),
  jobs: () => http<Job[]>('GET', '/api/jobs'),
  jobEventsUrl: (jobId: string) => `${BASE}/api/jobs/${jobId}/events`,
  notifications: () => http<Notification[]>('GET', '/api/notifications'),
  readNotification: (id: string) => http<void>('POST', `/api/notifications/${id}/read`),
};

export type Api = typeof api;
