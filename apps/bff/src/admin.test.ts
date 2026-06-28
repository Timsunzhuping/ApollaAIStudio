import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildHarness, type Harness } from './harness';
import { isAdmin } from './admin';

let h: Harness;
beforeAll(async () => { h = await buildHarness(); });
afterAll(async () => { await h.close?.(); });

describe('isAdmin (trusted allowlist)', () => {
  beforeEach(() => { process.env.ADMIN_EMAILS = 'boss@x.ai, ops@x.ai'; });
  afterEach(() => { delete process.env.ADMIN_EMAILS; });
  it('allows only allowlisted emails, case-insensitively', () => {
    expect(isAdmin('boss@x.ai')).toBe(true);
    expect(isAdmin('OPS@X.AI')).toBe(true);
    expect(isAdmin('user@x.ai')).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });
});

describe('admin aggregations (S23)', () => {
  it('reports site counts and user metadata without any private content', async () => {
    expect(h.admin).toBeDefined();
    const u = await h.users.register(`adm_${randomUUID()}@x.ai`, 'hash');
    await h.projects.create({ id: randomUUID(), ownerId: u.id, name: 'Secret Project', description: 'd' });
    await h.subscriptions.save({ ownerId: u.id, plan: 'pro', status: 'active' });
    await h.workspace.write({ ownerId: u.id, path: 'diary.md', content: 'PRIVATE_DIARY_TEXT' });
    await h.audit.record({ id: randomUUID(), ownerId: u.id, taskId: 'research', tool: 'research', risk: 'read', decision: 'allow', status: 'executed', summary: 'ran research' });

    const stats = await h.admin!.stats();
    expect(stats.users).toBeGreaterThanOrEqual(1);
    expect(stats.projects).toBeGreaterThanOrEqual(1);
    expect(stats.subscriptions.pro).toBeGreaterThanOrEqual(1);

    const users = await h.admin!.users(50);
    const row = users.find((r) => r.id === u.id);
    expect(row?.plan).toBe('pro');
    expect(row?.projects).toBeGreaterThanOrEqual(1);
    // metadata only — the private workspace body is nowhere in the admin payload
    expect(JSON.stringify(users)).not.toContain('PRIVATE_DIARY_TEXT');

    const detail = await h.admin!.userDetail(u.id);
    expect(detail?.email).toBe(u.email);
    expect(JSON.stringify(detail)).not.toContain('PRIVATE_DIARY_TEXT');

    const audit = await h.admin!.recentAudit(50);
    expect(audit.some((a) => a.ownerId === u.id && a.tool === 'research')).toBe(true);
    expect(JSON.stringify(audit)).not.toContain('PRIVATE_DIARY_TEXT');
  });
});
