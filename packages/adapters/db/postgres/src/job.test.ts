import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { InMemoryJobRepository } from '@apolla/harness-core';
import type { JobRepository } from '@apolla/harness-core';
import type { Job } from '@apolla/contracts';
import { createSql, migrate, type Sql } from './index';
import { PostgresJobRepository } from './job';

const job = (id: string, ownerId: string): Job => ({
  id,
  ownerId,
  kind: 'research',
  input: { question: 'x' },
  status: 'queued',
});

function suite(name: string, make: () => Promise<JobRepository>) {
  describe(`JobRepository: ${name}`, () => {
    it('creates, updates status, lists by owner, and replays its run-log in order', async () => {
      const repo = await make();
      await repo.create(job('j1', 'u1'));
      await repo.appendEvent('j1', { type: 'plan' });
      await repo.appendEvent('j1', { type: 'done' });
      await repo.save({ ...job('j1', 'u1'), status: 'done' });
      await repo.create(job('j2', 'u2'));
      expect((await repo.get('j1'))?.status).toBe('done');
      expect((await repo.events('j1')).map((e: any) => e.type)).toEqual(['plan', 'done']);
      expect((await repo.list('u1')).map((j) => j.id)).toEqual(['j1']);
    });
  });
}

suite('in-memory', async () => new InMemoryJobRepository());

const url = process.env.DATABASE_URL;
let sql: Sql | undefined;
if (url) sql = createSql(url);

describe.skipIf(!sql)('postgres jobs', () => {
  beforeAll(async () => {
    await migrate(sql!);
    await sql!`TRUNCATE jobs, job_events`;
  });
  afterAll(async () => {
    await sql?.end();
  });
  suite('postgres', async () => new PostgresJobRepository(sql!));
});
