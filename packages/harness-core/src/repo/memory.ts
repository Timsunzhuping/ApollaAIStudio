import type { Task } from '@apolla/contracts';
import type { TaskRepository } from './types';

/** In-memory TaskRepository. Stores deep clones so callers can't mutate persisted state. */
export class InMemoryTaskRepository implements TaskRepository {
  private readonly tasks = new Map<string, Task>();

  private clone(task: Task): Task {
    return structuredClone(task);
  }

  async create(task: Task): Promise<Task> {
    this.tasks.set(task.id, this.clone(task));
    return this.clone(task);
  }

  async get(id: string): Promise<Task | undefined> {
    const t = this.tasks.get(id);
    return t ? this.clone(t) : undefined;
  }

  async save(task: Task): Promise<void> {
    this.tasks.set(task.id, this.clone(task));
  }

  async list(ownerId?: string): Promise<Task[]> {
    return [...this.tasks.values()]
      .filter((t) => (ownerId ? t.ownerId === ownerId : true))
      .map((t) => this.clone(t));
  }
}
