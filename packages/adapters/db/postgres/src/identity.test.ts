import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { InMemoryUserRepository, InMemoryProjectRepository } from '@apolla/harness-core';
import type { UserRepository, ProjectRepository } from '@apolla/harness-core';
import { createSql, migrate, type Sql } from './index';
import { PostgresUserRepository, PostgresProjectRepository } from './repos';

function userSuite(name: string, make: () => Promise<UserRepository>) {
  describe(`UserRepository: ${name}`, () => {
    it('upsertByEmail is idempotent per email', async () => {
      const repo = await make();
      const a = await repo.upsertByEmail('a@x.test');
      const a2 = await repo.upsertByEmail('a@x.test');
      const b = await repo.upsertByEmail('b@x.test');
      expect(a.id).toBe(a2.id);
      expect(b.id).not.toBe(a.id);
      expect((await repo.get(a.id))?.email).toBe('a@x.test');
    });
  });
}

function projectSuite(name: string, make: () => Promise<ProjectRepository>) {
  describe(`ProjectRepository: ${name}`, () => {
    it('creates, gets, and lists by owner', async () => {
      const repo = await make();
      await repo.create({ id: 'p1', ownerId: 'u1', name: 'EV', description: 'EV research' });
      await repo.create({ id: 'p2', ownerId: 'u2', name: 'Other', description: '' });
      expect((await repo.get('p1'))?.name).toBe('EV');
      expect((await repo.list('u1')).map((p) => p.id)).toEqual(['p1']);
    });
  });
}

userSuite('in-memory', async () => new InMemoryUserRepository());
projectSuite('in-memory', async () => new InMemoryProjectRepository());

const url = process.env.DATABASE_URL;
let sql: Sql | undefined;
if (url) sql = createSql(url);

describe.skipIf(!sql)('postgres identity', () => {
  beforeAll(async () => {
    await migrate(sql!);
    await sql!`TRUNCATE users, projects`;
  });
  afterAll(async () => {
    await sql?.end();
  });
  userSuite('postgres', async () => new PostgresUserRepository(sql!));
  projectSuite('postgres', async () => new PostgresProjectRepository(sql!));
});
