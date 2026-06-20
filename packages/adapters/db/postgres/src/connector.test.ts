import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { InMemoryConnectorRepository } from '@apolla/harness-core';
import type { ConnectorRepository } from '@apolla/harness-core';
import type { Connector } from '@apolla/contracts';
import { createSql, migrate, type Sql } from './index';
import { PostgresConnectorRepository } from './connector';

const conn = (id: string, ownerId: string): Connector => ({
  id,
  ownerId,
  name: 'demo',
  transport: 'stub',
  args: [],
  readOnlyTools: ['echo'],
  disabledTools: [],
  enabled: true,
  tools: [{ name: 'echo', risk: 'read' }],
  secrets: { TOKEN: 'iv.tag.ct' },
});

function suite(name: string, make: () => Promise<ConnectorRepository>) {
  describe(`ConnectorRepository: ${name}`, () => {
    it('saves, updates, lists by owner, deletes', async () => {
      const repo = await make();
      await repo.save(conn('c1', 'u1'));
      await repo.save({ ...conn('c1', 'u1'), disabledTools: ['echo'] });
      await repo.save(conn('c2', 'u2'));
      expect((await repo.get('c1'))?.disabledTools).toEqual(['echo']);
      expect((await repo.list('u1')).map((c) => c.id)).toEqual(['c1']);
      await repo.delete('u1', 'c1');
      expect(await repo.list('u1')).toEqual([]);
    });
  });
}

suite('in-memory', async () => new InMemoryConnectorRepository());

const url = process.env.DATABASE_URL;
let sql: Sql | undefined;
if (url) sql = createSql(url);

describe.skipIf(!sql)('postgres connectors', () => {
  beforeAll(async () => {
    await migrate(sql!);
    await sql!`TRUNCATE connectors`;
  });
  afterAll(async () => {
    await sql?.end();
  });
  suite('postgres', async () => new PostgresConnectorRepository(sql!));
});
