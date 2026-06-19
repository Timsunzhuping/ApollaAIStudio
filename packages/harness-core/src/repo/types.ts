import type { Task, User, Project } from '@apolla/contracts';

/** Persistence boundary. Sprint 01 ships an in-memory impl; Postgres slots in behind this later. */
export interface TaskRepository {
  create(task: Task): Promise<Task>;
  get(id: string): Promise<Task | undefined>;
  save(task: Task): Promise<void>;
  list(ownerId?: string): Promise<Task[]>;
}

export interface UserRepository {
  /** Find-or-create a user by email (Sprint 02 email-identity auth). */
  upsertByEmail(email: string): Promise<User>;
  get(id: string): Promise<User | undefined>;
}

export interface ProjectRepository {
  create(project: Project): Promise<Project>;
  get(id: string): Promise<Project | undefined>;
  list(ownerId: string): Promise<Project[]>;
}
