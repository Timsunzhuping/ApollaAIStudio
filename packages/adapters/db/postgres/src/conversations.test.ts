import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { InMemoryConversationRepository } from '@apolla/harness-core';
import type { ConversationRepository } from '@apolla/harness-core';
import type { Conversation } from '@apolla/contracts';
import { createSql, migrate, type Sql } from './index';
import { PostgresConversationRepository } from './conversations';

const convo = (id: string, ownerId: string, updatedAt: string): Conversation => ({
  id,
  ownerId,
  title: `t-${id}`,
  messages: [
    { role: 'system', content: 'sys' },
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '你好！' },
  ],
  compacted: false,
  createdAt: '2026-07-05T00:00:00.000Z',
  updatedAt,
});

function suite(name: string, make: () => Promise<ConversationRepository>) {
  describe(`ConversationRepository: ${name}`, () => {
    it('creates, saves (upsert), lists newest-first per owner, and round-trips messages', async () => {
      const repo = await make();
      await repo.create(convo('c1', 'u1', '2026-07-05T10:00:00.000Z'));
      await repo.create(convo('c2', 'u1', '2026-07-05T11:00:00.000Z'));
      await repo.create(convo('c3', 'u2', '2026-07-05T12:00:00.000Z'));

      const updated = { ...convo('c1', 'u1', '2026-07-05T13:00:00.000Z'), compacted: true };
      updated.messages = [...updated.messages, { role: 'user', content: '再见' }];
      await repo.save(updated);

      const got = await repo.get('c1');
      expect(got?.compacted).toBe(true);
      expect(got?.messages).toHaveLength(4);

      const list = await repo.list('u1');
      expect(list.map((c) => c.id)).toEqual(['c1', 'c2']); // newest updated first
      expect((await repo.list('u2')).map((c) => c.id)).toEqual(['c3']);
      expect(await repo.get('missing')).toBeUndefined();
    });
  });
}

suite('in-memory', async () => new InMemoryConversationRepository());

const url = process.env.DATABASE_URL;
let sql: Sql | undefined;
if (url) sql = createSql(url);

describe.skipIf(!sql)('postgres conversations', () => {
  beforeAll(async () => {
    await migrate(sql!);
    await sql!`TRUNCATE conversations`;
  });
  afterAll(async () => {
    await sql!.end();
  });
  suite('postgres', async () => new PostgresConversationRepository(sql!));
});
