import type { Task, User, Project } from '@apolla/contracts';
import type { TaskRepository, UserRepository, ProjectRepository } from './types';

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

let idSeq = 0;
function genId(prefix: string): string {
  idSeq += 1;
  return `${prefix}_${idSeq}_${idSeq.toString(36)}`;
}

export class InMemoryUserRepository implements UserRepository {
  private readonly byId = new Map<string, User>();
  private readonly byEmail = new Map<string, string>();

  async upsertByEmail(email: string): Promise<User> {
    const existing = this.byEmail.get(email);
    if (existing) return structuredClone(this.byId.get(existing)!);
    const user: User = { id: genId('user'), email };
    this.byId.set(user.id, user);
    this.byEmail.set(email, user.id);
    return structuredClone(user);
  }

  async get(id: string): Promise<User | undefined> {
    const u = this.byId.get(id);
    return u ? structuredClone(u) : undefined;
  }
}

export class InMemoryProjectRepository implements ProjectRepository {
  private readonly projects = new Map<string, Project>();

  async create(project: Project): Promise<Project> {
    this.projects.set(project.id, structuredClone(project));
    return structuredClone(project);
  }

  async get(id: string): Promise<Project | undefined> {
    const p = this.projects.get(id);
    return p ? structuredClone(p) : undefined;
  }

  async list(ownerId: string): Promise<Project[]> {
    return [...this.projects.values()]
      .filter((p) => p.ownerId === ownerId)
      .map((p) => structuredClone(p));
  }
}
