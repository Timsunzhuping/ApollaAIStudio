import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { InMemoryPluginRepository } from '@apolla/harness-core';
import type { PluginRepository } from '@apolla/harness-core';
import type { Plugin } from '@apolla/contracts';
import { createSql, migrate, type Sql } from './index';
import { PostgresPluginRepository } from './plugin';

const plugin = (name: string): Plugin => ({
  name,
  description: 'd',
  skills: [
    { name: `${name}-skill`, triggers: ['t'], tools: [], io: {}, risk: 'read', promptRef: 'research.synthesize', executor: 'research' },
  ],
  requiredConnectors: [],
  commands: [],
});

function suite(label: string, make: () => Promise<PluginRepository>) {
  describe(`PluginRepository: ${label}`, () => {
    it('installs, lists per owner, surfaces skills, and uninstalls', async () => {
      const repo = await make();
      await repo.install('u1', plugin('research-analyst'));
      await repo.install('u2', plugin('personal-assistant'));
      expect((await repo.list('u1')).map((p) => p.name)).toEqual(['research-analyst']);
      expect((await repo.skillsFor('u1')).map((s) => s.name)).toEqual(['research-analyst-skill']);
      await repo.uninstall('u1', 'research-analyst');
      expect(await repo.list('u1')).toHaveLength(0);
      expect(await repo.skillsFor('u1')).toHaveLength(0);
    });
  });
}

suite('in-memory', async () => new InMemoryPluginRepository());

const url = process.env.DATABASE_URL;
let sql: Sql | undefined;
if (url) sql = createSql(url);

describe.skipIf(!sql)('postgres plugins', () => {
  beforeAll(async () => {
    await migrate(sql!);
    await sql!`TRUNCATE plugins`;
  });
  afterAll(async () => {
    await sql?.end();
  });
  suite('postgres', async () => new PostgresPluginRepository(sql!));
});
