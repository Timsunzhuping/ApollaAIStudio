import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { InMemoryMemory } from '@apolla/harness-core';
import type { Memory } from '@apolla/harness-core';
import { createSql, migrate, type Sql } from './index';
import { PostgresMemory } from './memory';

function memorySuite(name: string, make: () => Promise<Memory>) {
  describe(`Memory: ${name}`, () => {
    it('recalls relevant notes and ignores irrelevant ones', async () => {
      const mem = await make();
      await mem.note({ ownerId: 'u1', content: 'The EV battery market grew in 2026.' });
      await mem.note({ ownerId: 'u1', content: 'My favorite pasta recipe uses basil.' });
      const hits = await mem.recall('u1', 'electric vehicle battery');
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]!.content.toLowerCase()).toContain('battery');
    });

    it('isolates memory by owner', async () => {
      const mem = await make();
      await mem.note({ ownerId: 'u1', content: 'owner one secret about batteries' });
      await mem.note({ ownerId: 'u2', content: 'owner two note about batteries' });
      const hits = await mem.recall('u2', 'batteries');
      expect(hits.every((h) => h.ownerId === 'u2')).toBe(true);
    });

    it('stores and updates a user model, and clears on request', async () => {
      const mem = await make();
      await mem.setUserModel('u1', { language: 'Chinese', style: 'bulleted' });
      const m = await mem.setUserModel('u1', { formats: ['report'] });
      expect(m.language).toBe('Chinese');
      expect(m.formats).toEqual(['report']);
      await mem.clear('u1');
      expect(await mem.getUserModel('u1')).toBeUndefined();
    });
  });
}

memorySuite('in-memory', async () => new InMemoryMemory());

const url = process.env.DATABASE_URL;
let sql: Sql | undefined;
if (url) sql = createSql(url);

describe.skipIf(!sql)('postgres memory', () => {
  beforeAll(async () => {
    await migrate(sql!);
    await sql!`TRUNCATE memory_items, user_model`;
  });
  afterAll(async () => {
    await sql?.end();
  });
  memorySuite('postgres', async () => new PostgresMemory(sql!));
});
