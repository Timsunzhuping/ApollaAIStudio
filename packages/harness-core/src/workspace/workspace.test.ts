import { describe, it, expect } from 'vitest';
import { InMemoryWorkspaceRepository } from './memory';
import { normalizeWorkspacePath, PathError } from './path';

describe('normalizeWorkspacePath', () => {
  it('normalizes clean relative paths', () => {
    expect(normalizeWorkspacePath('a/b.md')).toBe('a/b.md');
    expect(normalizeWorkspacePath('./a//b.md')).toBe('a/b.md');
  });
  it('rejects traversal, absolute, and illegal paths', () => {
    for (const bad of ['../etc/passwd', 'a/../../b', '/abs/path', '', '   ', 'a\\b']) {
      expect(() => normalizeWorkspacePath(bad)).toThrow(PathError);
    }
  });
});

describe('InMemoryWorkspaceRepository (versioning)', () => {
  it('appends versions, reads latest/old, lists, and rolls back', async () => {
    const ws = new InMemoryWorkspaceRepository();
    const v1 = await ws.write({ ownerId: 'u', path: 'report.md', content: 'first' });
    expect(v1.version).toBe(1);
    const v2 = await ws.write({ ownerId: 'u', path: 'report.md', content: 'second' });
    expect(v2.version).toBe(2);

    expect((await ws.read('u', 'report.md'))?.content).toBe('second');
    expect((await ws.read('u', 'report.md', { version: 1 }))?.content).toBe('first');
    expect(await ws.history('u', 'report.md')).toHaveLength(2);

    const entries = await ws.list('u');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ path: 'report.md', version: 2 });

    const v3 = await ws.rollback('u', 'report.md', 1);
    expect(v3.version).toBe(3);
    expect(v3.content).toBe('first');
    expect((await ws.read('u', 'report.md'))?.content).toBe('first');
  });

  it('isolates by owner and project', async () => {
    const ws = new InMemoryWorkspaceRepository();
    await ws.write({ ownerId: 'u', path: 'a.md', content: 'mine' });
    await ws.write({ ownerId: 'u', projectId: 'p1', path: 'a.md', content: 'project' });
    expect(await ws.read('other', 'a.md')).toBeUndefined();
    expect((await ws.read('u', 'a.md'))?.content).toBe('mine');
    expect((await ws.read('u', 'a.md', { projectId: 'p1' }))?.content).toBe('project');
    expect(await ws.list('u')).toHaveLength(1);
    expect(await ws.list('u', { projectId: 'p1' })).toHaveLength(1);
  });

  it('rejects traversal paths at the repo layer too', async () => {
    const ws = new InMemoryWorkspaceRepository();
    await expect(ws.write({ ownerId: 'u', path: '../escape.md', content: 'x' })).rejects.toThrow(PathError);
  });
});
