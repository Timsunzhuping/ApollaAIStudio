import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { InMemoryWorkspaceRepository } from '@apolla/harness-core';
import type { WorkspaceRepository } from '@apolla/harness-core';
import { createSql, migrate, type Sql } from './index';
import { PostgresWorkspaceRepository } from './workspace';

function suite(label: string, make: () => Promise<WorkspaceRepository>) {
  describe(`WorkspaceRepository: ${label}`, () => {
    it('versions, reads latest/old, lists, rolls back, isolates owners', async () => {
      const ws = await make();
      const v1 = await ws.write({ ownerId: 'w1', path: 'report.md', content: 'first' });
      expect(v1.version).toBe(1);
      const v2 = await ws.write({ ownerId: 'w1', path: 'report.md', content: 'second' });
      expect(v2.version).toBe(2);
      expect((await ws.read('w1', 'report.md'))?.content).toBe('second');
      expect((await ws.read('w1', 'report.md', { version: 1 }))?.content).toBe('first');
      expect(await ws.history('w1', 'report.md')).toHaveLength(2);
      expect((await ws.list('w1')).map((e) => e.path)).toEqual(['report.md']);
      const v3 = await ws.rollback('w1', 'report.md', 1);
      expect(v3.version).toBe(3);
      expect(v3.content).toBe('first');
      expect(await ws.read('w2', 'report.md')).toBeUndefined();
    });
  });
}

suite('in-memory', async () => new InMemoryWorkspaceRepository());

const url = process.env.DATABASE_URL;
let sql: Sql | undefined;
if (url) sql = createSql(url);

describe.skipIf(!sql)('postgres workspace', () => {
  beforeAll(async () => {
    await migrate(sql!);
    await sql!`TRUNCATE workspace_files`;
  });
  afterAll(async () => {
    await sql?.end();
  });
  suite('postgres', async () => new PostgresWorkspaceRepository(sql!));
});
