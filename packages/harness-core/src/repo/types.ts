import type { Task, User, Project, Connector, AuditEntry } from '@apolla/contracts';

/** Persistence boundary. Sprint 01 ships an in-memory impl; Postgres slots in behind this later. */
export interface TaskRepository {
  create(task: Task): Promise<Task>;
  get(id: string): Promise<Task | undefined>;
  save(task: Task): Promise<void>;
  list(ownerId?: string): Promise<Task[]>;
}

export interface UserRepository {
  /** Find-or-create a user by email (demo email-identity auth). */
  upsertByEmail(email: string): Promise<User>;
  get(id: string): Promise<User | undefined>;
  /** Create a user with a password hash (S10). Throws if the email already exists. */
  register(email: string, passwordHash: string): Promise<User>;
  /** Look up a user + their stored password hash by email (hash is null for passwordless demo users). */
  findCredentialByEmail(email: string): Promise<{ user: User; passwordHash: string | null } | undefined>;
}

export interface ProjectRepository {
  create(project: Project): Promise<Project>;
  get(id: string): Promise<Project | undefined>;
  list(ownerId: string): Promise<Project[]>;
}

export interface ConnectorRepository {
  save(connector: Connector): Promise<Connector>;
  get(id: string): Promise<Connector | undefined>;
  list(ownerId: string): Promise<Connector[]>;
  delete(ownerId: string, id: string): Promise<void>;
}

export interface AuditRepository {
  record(entry: AuditEntry): Promise<void>;
  list(ownerId: string, taskId?: string): Promise<AuditEntry[]>;
}
