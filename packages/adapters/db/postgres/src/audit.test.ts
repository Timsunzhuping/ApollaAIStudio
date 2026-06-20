import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { InMemoryAuditRepository } from '@apolla/harness-core';
import type { AuditRepository } from '@apolla/harness-core';
import type { AuditEntry } from '@apolla/contracts';
import { createSql, migrate, type Sql } from './index';
import { PostgresAuditRepository } from './audit';

const entry = (id: string, ownerId: string, taskId: string): AuditEntry => ({
  id,
  ownerId,
  taskId,
  tool: 'demo/save_note',
  risk: 'low_write',
  decision: 'confirm',
  confirmed: true,
  status: 'executed',
});

function suite(name: string, make: () => Promise<AuditRepository>) {
  describe(`AuditRepository: ${name}`, () => {
    it('records and lists by owner and task', async () => {
      const repo = await make();
      await repo.record(entry('a1', 'u1', 't1'));
      await repo.record(entry('a2', 'u1', 't1'));
      await repo.record(entry('a3', 'u1', 't2'));
      await repo.record(entry('a4', 'u2', 't1'));
      expect((await repo.list('u1')).length).toBe(3);
      expect((await repo.list('u1', 't1')).map((e) => e.id).sort()).toEqual(['a1', 'a2']);
      expect((await repo.list('u2')).length).toBe(1);
    });
  });
}

suite('in-memory', async () => new InMemoryAuditRepository());

const url = process.env.DATABASE_URL;
let sql: Sql | undefined;
if (url) sql = createSql(url);

describe.skipIf(!sql)('postgres audit', () => {
  beforeAll(async () => {
    await migrate(sql!);
    await sql!`TRUNCATE audit_log`;
  });
  afterAll(async () => {
    await sql?.end();
  });
  suite('postgres', async () => new PostgresAuditRepository(sql!));
});
