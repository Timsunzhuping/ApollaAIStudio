import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { InMemoryMediaRepository } from '@apolla/harness-core';
import type { MediaRepository } from '@apolla/harness-core';
import type { MediaJob } from '@apolla/contracts';
import { createSql, migrate, type Sql } from './index';
import { PostgresMediaRepository } from './media';

const job: MediaJob = { kind: 'image', prompt: 'cover', params: {} };

function suite(name: string, make: () => Promise<MediaRepository>) {
  describe(`MediaRepository: ${name}`, () => {
    it('creates, updates status, lists by owner', async () => {
      const repo = await make();
      await repo.create({ id: 'm1', ownerId: 'u1', alias: 'image_fast', job, status: 'submitted', assets: [], costUsd: 0, moderated: false });
      await repo.save({ id: 'm1', ownerId: 'u1', alias: 'image_fast', job, status: 'ready', assets: [], costUsd: 0.01, moderated: true });
      await repo.create({ id: 'm2', ownerId: 'u2', alias: 'video_premium', job: { ...job, kind: 'video' }, status: 'ready', assets: [], costUsd: 0.2, moderated: true });
      expect((await repo.get('m1'))?.status).toBe('ready');
      expect((await repo.list('u1')).map((t) => t.id)).toEqual(['m1']);
    });
  });
}

suite('in-memory', async () => new InMemoryMediaRepository());

const url = process.env.DATABASE_URL;
let sql: Sql | undefined;
if (url) sql = createSql(url);

describe.skipIf(!sql)('postgres media-repo', () => {
  beforeAll(async () => {
    await migrate(sql!);
    await sql!`TRUNCATE media_tasks`;
  });
  afterAll(async () => {
    await sql?.end();
  });
  suite('postgres', async () => new PostgresMediaRepository(sql!));
});
