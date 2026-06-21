import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { InMemoryNotificationRepository } from '@apolla/harness-core';
import type { NotificationRepository } from '@apolla/harness-core';
import type { Notification } from '@apolla/contracts';
import { createSql, migrate, type Sql } from './index';
import { PostgresNotificationRepository } from './notification';

const notif = (id: string, ownerId: string): Notification => ({
  id,
  ownerId,
  kind: 'job-done',
  title: 'research done',
  jobId: 'j1',
  read: false,
});

function suite(name: string, make: () => Promise<NotificationRepository>) {
  describe(`NotificationRepository: ${name}`, () => {
    it('creates, lists by owner, and marks read', async () => {
      const repo = await make();
      await repo.create(notif('n1', 'u1'));
      await repo.create(notif('n2', 'u2'));
      expect((await repo.list('u1')).map((n) => n.id)).toEqual(['n1']);
      await repo.markRead('u1', 'n1');
      expect((await repo.list('u1'))[0]!.read).toBe(true);
    });
  });
}

suite('in-memory', async () => new InMemoryNotificationRepository());

const url = process.env.DATABASE_URL;
let sql: Sql | undefined;
if (url) sql = createSql(url);

describe.skipIf(!sql)('postgres notifications', () => {
  beforeAll(async () => {
    await migrate(sql!);
    await sql!`TRUNCATE notifications`;
  });
  afterAll(async () => {
    await sql?.end();
  });
  suite('postgres', async () => new PostgresNotificationRepository(sql!));
});
