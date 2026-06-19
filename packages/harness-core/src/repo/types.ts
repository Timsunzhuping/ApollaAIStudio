import type { Task } from '@apolla/contracts';

/** Persistence boundary. Sprint 01 ships an in-memory impl; Postgres slots in behind this later. */
export interface TaskRepository {
  create(task: Task): Promise<Task>;
  get(id: string): Promise<Task | undefined>;
  save(task: Task): Promise<void>;
  list(ownerId?: string): Promise<Task[]>;
}
