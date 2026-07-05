import { randomUUID } from 'node:crypto';
import { AccountBundle } from '@apolla/contracts';
import type { Harness } from './harness';

/**
 * Account data lifecycle (S22). Export aggregates the caller's own data across the owner-keyed repos
 * into a portable bundle — with EVERY secret stripped (connector secrets, and we never read password
 * hashes / TOTP / token material here at all). Import re-owns everything to the CALLER and mints fresh
 * ids for id-keyed rows, so a bundle can never overwrite or impersonate another tenant.
 */
export async function buildAccountBundle(h: Harness, ownerId: string, email: string): Promise<AccountBundle> {
  const [projects, skills, wsEntries, schedules, notifications, plugins, connectors, tasks, userModel, conversations] = await Promise.all([
    h.projects.list(ownerId),
    h.skillRepo.list(ownerId),
    h.workspace.list(ownerId),
    h.scheduleRepo.list(ownerId),
    h.notifications.list(ownerId),
    h.plugins.list(ownerId),
    h.connectors.list(ownerId),
    h.repo.list(ownerId),
    h.memory.getUserModel(ownerId),
    h.conversations.list(ownerId),
  ]);
  // Workspace list returns metadata only — read each file's content for a faithful export.
  const workspace = await Promise.all(
    wsEntries.map(async (e: { path: string }) => {
      const file = await h.workspace.read(ownerId, e.path);
      return { path: e.path, content: file?.content ?? '', mime: file?.mime };
    }),
  );
  return AccountBundle.parse({
    version: 1,
    exportedAt: new Date().toISOString(),
    email,
    projects,
    skills,
    workspace,
    schedules,
    notifications,
    plugins,
    // Connector secrets are encrypted credentials — they NEVER leave the server.
    connectors: connectors.map((c: Record<string, unknown>) => ({ ...c, secrets: {} })),
    tasks,
    conversations,
    userModel: userModel ?? null,
  });
}

/** Restore the cleanly round-trippable, non-executing data from a bundle, re-owned to the caller. */
export async function importBundle(h: Harness, ownerId: string, bundle: AccountBundle): Promise<{ projects: number; skills: number; workspace: number; userModel: boolean }> {
  let projects = 0;
  for (const p of bundle.projects) {
    await h.projects.create({ id: randomUUID(), ownerId, name: String(p.name ?? 'Untitled'), description: String(p.description ?? '') });
    projects++;
  }
  let skills = 0;
  for (const s of bundle.skills) {
    try { await h.skillRepo.save(ownerId, s as never); skills++; } catch { /* skip malformed skill */ }
  }
  let workspace = 0;
  for (const f of bundle.workspace) {
    await h.workspace.write({ ownerId, path: String(f.path), content: String(f.content ?? ''), mime: f.mime ? String(f.mime) : undefined });
    workspace++;
  }
  let userModel = false;
  if (bundle.userModel && typeof bundle.userModel === 'object') {
    const { ownerId: _o, ...patch } = bundle.userModel as Record<string, unknown>;
    await h.memory.setUserModel(ownerId, patch as never);
    userModel = true;
  }
  // Schedules, notifications, connectors and tasks are intentionally NOT imported: schedules could
  // auto-execute, connectors carry stripped secrets, and notifications/tasks are transient/derived.
  return { projects, skills, workspace, userModel };
}
