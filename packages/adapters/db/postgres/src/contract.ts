import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { Task, type Task as TaskT } from '@apolla/contracts';
import type { TaskRepository } from '@apolla/harness-core';

export function makeTask(over: Partial<TaskT> & Pick<TaskT, 'id' | 'ownerId'>): TaskT {
  return Task.parse({ type: 'research', state: 'plan', ...over });
}

export interface RepoContractHooks {
  /** Return a clean repository for each test (truncate for a shared DB). */
  fresh: () => Promise<TaskRepository>;
  teardown?: () => Promise<void>;
  skip?: boolean;
}

/**
 * One behaviour contract that BOTH InMemoryTaskRepository and PostgresTaskRepository must satisfy.
 * Proves upgrade-by-swap: the persistence backend changes without changing semantics.
 */
export function runTaskRepositoryContract(name: string, hooks: RepoContractHooks): void {
  const d = hooks.skip ? describe.skip : describe;
  d(`TaskRepository contract: ${name}`, () => {
    let repo: TaskRepository;
    beforeEach(async () => {
      repo = await hooks.fresh();
    });
    afterAll(async () => {
      await hooks.teardown?.();
    });

    it('create then get round-trips', async () => {
      await repo.create(makeTask({ id: 'a', ownerId: 'u1' }));
      const got = await repo.get('a');
      expect(got?.id).toBe('a');
      expect(got?.state).toBe('plan');
      expect(got?.ownerId).toBe('u1');
    });

    it('get returns undefined for unknown id', async () => {
      expect(await repo.get('missing')).toBeUndefined();
    });

    it('save updates an existing task', async () => {
      const t = await repo.create(makeTask({ id: 'b', ownerId: 'u1' }));
      await repo.save({ ...t, state: 'done' });
      expect((await repo.get('b'))?.state).toBe('done');
    });

    it('list filters by owner and isolates users', async () => {
      await repo.create(makeTask({ id: 'a', ownerId: 'u1' }));
      await repo.create(makeTask({ id: 'b', ownerId: 'u1' }));
      await repo.create(makeTask({ id: 'c', ownerId: 'u2' }));
      expect((await repo.list('u1')).map((t) => t.id).sort()).toEqual(['a', 'b']);
      expect((await repo.list('u2')).map((t) => t.id)).toEqual(['c']);
      expect((await repo.list()).length).toBe(3);
    });

    it('does not leak mutations of returned objects into storage', async () => {
      const created = await repo.create(makeTask({ id: 'x', ownerId: 'u1' }));
      created.state = 'failed';
      expect((await repo.get('x'))?.state).toBe('plan');
    });
  });
}
