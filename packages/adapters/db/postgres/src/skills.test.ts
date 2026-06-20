import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SkillDef } from '@apolla/contracts';
import { InMemorySkillRepository } from '@apolla/harness-core';
import type { SkillRepository } from '@apolla/harness-core';
import { createSql, migrate, type Sql } from './index';
import { PostgresSkillRepository } from './repos';

const skill = (name: string): SkillDef => ({
  name,
  triggers: [name],
  tools: ['web_search'],
  io: {},
  risk: 'read',
  promptRef: 'research.synthesize',
  executor: 'research',
});

function suite(name: string, make: () => Promise<SkillRepository>) {
  describe(`SkillRepository: ${name}`, () => {
    it('saves, lists, upserts, and deletes per owner', async () => {
      const repo = await make();
      await repo.save('u1', skill('a'));
      await repo.save('u1', { ...skill('a'), triggers: ['updated'] });
      await repo.save('u2', skill('b'));
      expect((await repo.list('u1')).map((s) => s.name)).toEqual(['a']);
      expect((await repo.list('u1'))[0]!.triggers).toEqual(['updated']);
      await repo.delete('u1', 'a');
      expect(await repo.list('u1')).toEqual([]);
    });
  });
}

suite('in-memory', async () => new InMemorySkillRepository());

const url = process.env.DATABASE_URL;
let sql: Sql | undefined;
if (url) sql = createSql(url);

describe.skipIf(!sql)('postgres skills', () => {
  beforeAll(async () => {
    await migrate(sql!);
    await sql!`TRUNCATE skills`;
  });
  afterAll(async () => {
    await sql?.end();
  });
  suite('postgres', async () => new PostgresSkillRepository(sql!));
});
