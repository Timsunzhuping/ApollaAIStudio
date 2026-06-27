import { describe, it, expect } from 'vitest';
import type { AuditEntry } from '@apolla/contracts';
import { InMemoryWorkspaceRepository } from './memory';
import { GuardedWorkspaceRepository } from './guard';
import { PathError } from './path';

function guard(limits?: { maxFiles?: number; maxBytes?: number }) {
  const audited: AuditEntry[] = [];
  const repo = new GuardedWorkspaceRepository({ base: new InMemoryWorkspaceRepository(), limits, audit: (e) => { audited.push(e); } });
  return { repo, audited };
}

describe('GuardedWorkspaceRepository (S7-T6)', () => {
  it('audits every successful write', async () => {
    const { repo, audited } = guard();
    await repo.write({ ownerId: 'u', path: 'a.md', content: 'hi' });
    expect(audited.at(-1)).toMatchObject({ tool: 'fs_write', status: 'executed', ownerId: 'u' });
  });

  it('rejects + audits a traversal path', async () => {
    const { repo, audited } = guard();
    await expect(repo.write({ ownerId: 'u', path: '../escape.md', content: 'x' })).rejects.toThrow(PathError);
    expect(audited.at(-1)).toMatchObject({ status: 'denied' });
    expect(await repo.list('u')).toHaveLength(0);
  });

  it('enforces the file-count quota', async () => {
    const { repo, audited } = guard({ maxFiles: 2 });
    await repo.write({ ownerId: 'u', path: 'a.md', content: 'x' });
    await repo.write({ ownerId: 'u', path: 'b.md', content: 'x' });
    await expect(repo.write({ ownerId: 'u', path: 'c.md', content: 'x' })).rejects.toThrow(/file quota/);
    // overwriting an existing path is still allowed (not a new file)
    await expect(repo.write({ ownerId: 'u', path: 'a.md', content: 'y' })).resolves.toMatchObject({ version: 2 });
    expect(audited.some((e) => e.status === 'denied' && (e.summary ?? '').includes('file quota'))).toBe(true);
  });

  it('enforces the byte quota', async () => {
    const { repo } = guard({ maxBytes: 10 });
    await repo.write({ ownerId: 'u', path: 'a.md', content: '12345' });
    await expect(repo.write({ ownerId: 'u', path: 'b.md', content: '1234567' })).rejects.toThrow(/byte quota/);
  });

  it('isolates owners (quota counted per owner)', async () => {
    const { repo } = guard({ maxFiles: 1 });
    await repo.write({ ownerId: 'u1', path: 'a.md', content: 'x' });
    await expect(repo.write({ ownerId: 'u2', path: 'a.md', content: 'x' })).resolves.toBeTruthy();
  });
});
