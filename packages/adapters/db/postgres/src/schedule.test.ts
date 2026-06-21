import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { InMemoryScheduledTaskRepository } from '@apolla/harness-core';
import type { ScheduledTaskRepository } from '@apolla/harness-core';
import type { ScheduledTask } from '@apolla/contracts';
import { createSql, migrate, type Sql } from './index';
import { PostgresScheduledTaskRepository } from './schedule';

const task = (id: string, ownerId: string, enabled = true): ScheduledTask => ({
  id,
  ownerId,
  name: 'daily',
  cron: '0 8 * * *',
  jobSpec: { kind: 'skill', input: { skill: 'research' }, allowTools: [] },
  enabled,
});

function suite(name: string, make: () => Promise<ScheduledTaskRepository>) {
  describe(`ScheduledTaskRepository: ${name}`, () => {
    it('saves, lists by owner, lists enabled, toggles, deletes', async () => {
      const repo = await make();
      await repo.save(task('t1', 'u1', true));
      await repo.save(task('t2', 'u1', false));
      await repo.save(task('t3', 'u2', true));
      expect((await repo.list('u1')).map((t) => t.id).sort()).toEqual(['t1', 't2']);
      expect((await repo.listEnabled()).map((t) => t.id).sort()).toEqual(['t1', 't3']);
      await repo.delete('u1', 't1');
      expect((await repo.list('u1')).map((t) => t.id)).toEqual(['t2']);
    });
  });
}

suite('in-memory', async () => new InMemoryScheduledTaskRepository());

const url = process.env.DATABASE_URL;
let sql: Sql | undefined;
if (url) sql = createSql(url);

describe.skipIf(!sql)('postgres scheduled-tasks', () => {
  beforeAll(async () => {
    await migrate(sql!);
    await sql!`TRUNCATE scheduled_tasks`;
  });
  afterAll(async () => {
    await sql?.end();
  });
  suite('postgres', async () => new PostgresScheduledTaskRepository(sql!));
});
