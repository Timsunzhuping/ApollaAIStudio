import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildHarness, type Harness } from './harness';
import { buildAccountBundle, importBundle } from './account';

let h: Harness;
const mk = async (): Promise<string> => (await h.users.register(`acct_${randomUUID()}@x.ai`, 'hash')).id;

async function seed(ownerId: string) {
  await h.projects.create({ id: randomUUID(), ownerId, name: 'Proj', description: 'mine' });
  await h.skillRepo.save(ownerId, { name: 'greet', description: 'hi', promptRef: 'p1', allowTools: [] } as never);
  await h.workspace.write({ ownerId, path: 'notes/a.md', content: 'hello world' });
  await h.connectors.save({ id: randomUUID(), ownerId, name: 'gh', transport: 'stub', args: [], readOnlyTools: [], disabledTools: [], enabled: true, tools: [], secrets: { token: 'SUPER_SECRET_VALUE' } });
}

beforeAll(async () => { h = await buildHarness(); });
afterAll(async () => { await h.close?.(); });

describe('account export + purge (S22)', () => {
  it('exports the owner data with all secrets stripped', async () => {
    const owner = await mk();
    await seed(owner);
    const bundle = await buildAccountBundle(h, owner, 'me@x.ai');
    expect(bundle.version).toBe(1);
    expect(bundle.projects.map((p) => p.name)).toContain('Proj');
    expect(bundle.skills.map((s) => s.name)).toContain('greet');
    expect(bundle.workspace.find((f) => f.path === 'notes/a.md')?.content).toBe('hello world');
    // the connector is exported but its secrets are emptied — the secret value appears nowhere.
    expect(bundle.connectors[0]?.secrets).toEqual({});
    expect(JSON.stringify(bundle)).not.toContain('SUPER_SECRET_VALUE');
  });

  it('purgeOwner cascades the caller and leaves other tenants intact', async () => {
    const a = await mk();
    const b = await mk();
    await seed(a);
    await seed(b);
    expect(h.purgeOwner).toBeTypeOf('function');
    await h.purgeOwner!(a);
    expect(await h.projects.list(a)).toHaveLength(0);
    expect(await h.skillRepo.list(a)).toHaveLength(0);
    expect(await h.workspace.list(a)).toHaveLength(0);
    expect(await h.users.get(a)).toBeUndefined();
    // b is untouched
    expect(await h.projects.list(b)).toHaveLength(1);
    expect(await h.users.get(b)).toBeDefined();
  });

  it('import re-owns the bundle to the caller (no impersonation)', async () => {
    const src = await mk();
    await seed(src);
    const bundle = await buildAccountBundle(h, src, 'src@x.ai');
    const dst = await mk();
    const counts = await importBundle(h, dst, bundle);
    expect(counts.projects).toBe(1);
    const dstProjects = await h.projects.list(dst);
    expect(dstProjects).toHaveLength(1);
    expect(dstProjects[0]!.ownerId).toBe(dst); // re-owned, not the source owner
    expect((await h.workspace.read(dst, 'notes/a.md'))?.content).toBe('hello world');
  });
});
