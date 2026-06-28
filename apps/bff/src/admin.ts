import type { Sql } from '@apolla/db-postgres';
import type { AdminStats, AdminUserRow, AdminUserDetail, AdminAuditRow } from '@apolla/contracts';

/**
 * Operator console (S23). Admin status comes ONLY from the ADMIN_EMAILS env allowlist — never from a
 * client field or a user-writable column, so a user can't escalate themselves. The aggregations return
 * counts + metadata only; they never read another user's private content (workspace bodies, research
 * results, secrets).
 */
export function isAdmin(email: string | undefined): boolean {
  if (!email) return false;
  const allow = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allow.includes(email.toLowerCase());
}

export interface AdminApi {
  stats(): Promise<AdminStats>;
  recentAudit(limit: number): Promise<AdminAuditRow[]>;
  users(limit: number): Promise<AdminUserRow[]>;
  userDetail(id: string): Promise<AdminUserDetail | undefined>;
}

const n = (v: unknown): number => Number(v ?? 0);

export function buildAdminApi(sql: Sql): AdminApi {
  return {
    async stats(): Promise<AdminStats> {
      const [[users], [projects], [tasks], jobRows, subRows] = await Promise.all([
        sql<{ c: string }[]>`SELECT COUNT(*)::int AS c FROM users`,
        sql<{ c: string }[]>`SELECT COUNT(*)::int AS c FROM projects`,
        sql<{ c: string }[]>`SELECT COUNT(*)::int AS c FROM tasks`,
        sql<{ status: string; c: string }[]>`SELECT status, COUNT(*)::int AS c FROM jobs GROUP BY status`,
        sql<{ plan: string | null; c: string }[]>`SELECT data->>'plan' AS plan, COUNT(*)::int AS c FROM subscriptions GROUP BY data->>'plan'`,
      ]);
      const jobs: Record<string, number> = {};
      for (const r of jobRows) jobs[r.status] = n(r.c);
      const subscriptions: Record<string, number> = {};
      for (const r of subRows) subscriptions[r.plan ?? 'unknown'] = n(r.c);
      return { users: n(users?.c), projects: n(projects?.c), tasks: n(tasks?.c), jobs, subscriptions };
    },

    async recentAudit(limit: number): Promise<AdminAuditRow[]> {
      const rows = await sql<{ id: string; owner_id: string; data: Record<string, unknown>; created_at: Date }[]>`
        SELECT id, owner_id, data, created_at FROM audit_log ORDER BY created_at DESC LIMIT ${Math.min(limit, 200)}
      `;
      // Curate to operational metadata only — no raw payloads.
      return rows.map((r) => ({
        id: r.id,
        ownerId: r.owner_id,
        tool: String(r.data.tool ?? ''),
        risk: String(r.data.risk ?? ''),
        decision: String(r.data.decision ?? ''),
        status: String(r.data.status ?? ''),
        summary: String(r.data.summary ?? '').slice(0, 200),
        createdAt: r.created_at.toISOString(),
      }));
    },

    async users(limit: number): Promise<AdminUserRow[]> {
      const rows = await sql<{ id: string; email: string; created_at: Date; plan: string | null; projects: string }[]>`
        SELECT u.id, u.email, u.created_at,
               (SELECT s.data->>'plan' FROM subscriptions s WHERE s.owner_id = u.id) AS plan,
               (SELECT COUNT(*)::int FROM projects p WHERE p.owner_id = u.id) AS projects
        FROM users u ORDER BY u.created_at DESC LIMIT ${Math.min(limit, 200)}
      `;
      return rows.map((r) => ({ id: r.id, email: r.email, createdAt: r.created_at.toISOString(), plan: r.plan, projects: n(r.projects) }));
    },

    async userDetail(id: string): Promise<AdminUserDetail | undefined> {
      const rows = await sql<{ id: string; email: string; created_at: Date; plan: string | null; projects: string; tasks: string; jobs: string }[]>`
        SELECT u.id, u.email, u.created_at,
               (SELECT s.data->>'plan' FROM subscriptions s WHERE s.owner_id = u.id) AS plan,
               (SELECT COUNT(*)::int FROM projects p WHERE p.owner_id = u.id) AS projects,
               (SELECT COUNT(*)::int FROM tasks t WHERE t.owner_id = u.id) AS tasks,
               (SELECT COUNT(*)::int FROM jobs j WHERE j.owner_id = u.id) AS jobs
        FROM users u WHERE u.id = ${id}
      `;
      const r = rows[0];
      if (!r) return undefined;
      return { id: r.id, email: r.email, createdAt: r.created_at.toISOString(), plan: r.plan, projects: n(r.projects), tasks: n(r.tasks), jobs: n(r.jobs) };
    },
  };
}
