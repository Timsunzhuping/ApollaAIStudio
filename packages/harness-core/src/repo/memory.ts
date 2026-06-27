import type { Task, User, Project, SkillDef, MediaTask, Connector, AuditEntry, Job, ScheduledTask, Notification, Plugin } from '@apolla/contracts';
import type { PluginRepository } from '../plugins/types';
import type { JobRepository } from '../jobs/types';
import type { ScheduledTaskRepository } from '../schedule/scheduler';
import type { NotificationRepository } from '../notify/notify';
import type {
  TaskRepository,
  UserRepository,
  ProjectRepository,
  ConnectorRepository,
  AuditRepository,
} from './types';
import type { SkillRepository, SkillSource } from '../skills/types';
import type { MediaRepository } from '../media/types';

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
  private readonly hashByOwner = new Map<string, string>();

  async upsertByEmail(email: string): Promise<User> {
    const existing = this.byEmail.get(email);
    if (existing) return structuredClone(this.byId.get(existing)!);
    const user: User = { id: genId('user'), email };
    this.byId.set(user.id, user);
    this.byEmail.set(email, user.id);
    return structuredClone(user);
  }

  async register(email: string, passwordHash: string): Promise<User> {
    if (this.byEmail.has(email)) throw new Error('email already registered');
    const user: User = { id: genId('user'), email };
    this.byId.set(user.id, user);
    this.byEmail.set(email, user.id);
    this.hashByOwner.set(user.id, passwordHash);
    return structuredClone(user);
  }

  async findCredentialByEmail(email: string): Promise<{ user: User; passwordHash: string | null } | undefined> {
    const id = this.byEmail.get(email);
    if (!id) return undefined;
    return { user: structuredClone(this.byId.get(id)!), passwordHash: this.hashByOwner.get(id) ?? null };
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

export class InMemorySkillRepository implements SkillRepository {
  private readonly byOwner = new Map<string, Map<string, SkillDef>>();

  async save(ownerId: string, def: SkillDef): Promise<SkillDef> {
    const map = this.byOwner.get(ownerId) ?? new Map();
    map.set(def.name, structuredClone(def));
    this.byOwner.set(ownerId, map);
    return structuredClone(def);
  }

  async list(ownerId: string): Promise<SkillDef[]> {
    return [...(this.byOwner.get(ownerId)?.values() ?? [])].map((d) => structuredClone(d));
  }

  async delete(ownerId: string, name: string): Promise<void> {
    this.byOwner.get(ownerId)?.delete(name);
  }
}

export class InMemoryConnectorRepository implements ConnectorRepository {
  private readonly byId = new Map<string, Connector>();

  async save(connector: Connector): Promise<Connector> {
    this.byId.set(connector.id, structuredClone(connector));
    return structuredClone(connector);
  }

  async get(id: string): Promise<Connector | undefined> {
    const c = this.byId.get(id);
    return c ? structuredClone(c) : undefined;
  }

  async list(ownerId: string): Promise<Connector[]> {
    return [...this.byId.values()].filter((c) => c.ownerId === ownerId).map((c) => structuredClone(c));
  }

  async delete(ownerId: string, id: string): Promise<void> {
    const c = this.byId.get(id);
    if (c && c.ownerId === ownerId) this.byId.delete(id);
  }
}

export class InMemoryJobRepository implements JobRepository {
  private readonly jobs = new Map<string, Job>();
  private readonly log = new Map<string, unknown[]>();

  async create(job: Job): Promise<Job> {
    this.jobs.set(job.id, structuredClone(job));
    this.log.set(job.id, []);
    return structuredClone(job);
  }

  async get(id: string): Promise<Job | undefined> {
    const j = this.jobs.get(id);
    return j ? structuredClone(j) : undefined;
  }

  async save(job: Job): Promise<void> {
    this.jobs.set(job.id, structuredClone(job));
  }

  async list(ownerId: string): Promise<Job[]> {
    return [...this.jobs.values()].filter((j) => j.ownerId === ownerId).map((j) => structuredClone(j));
  }

  async listNonTerminal(): Promise<Job[]> {
    return [...this.jobs.values()].filter((j) => j.status === 'queued' || j.status === 'running').map((j) => structuredClone(j));
  }

  async appendEvent(jobId: string, event: unknown): Promise<void> {
    (this.log.get(jobId) ?? this.log.set(jobId, []).get(jobId)!).push(structuredClone(event));
  }

  async events(jobId: string): Promise<unknown[]> {
    return structuredClone(this.log.get(jobId) ?? []);
  }
}

export class InMemoryScheduledTaskRepository implements ScheduledTaskRepository {
  private readonly byId = new Map<string, ScheduledTask>();

  async save(task: ScheduledTask): Promise<ScheduledTask> {
    this.byId.set(task.id, structuredClone(task));
    return structuredClone(task);
  }

  async get(id: string): Promise<ScheduledTask | undefined> {
    const t = this.byId.get(id);
    return t ? structuredClone(t) : undefined;
  }

  async list(ownerId: string): Promise<ScheduledTask[]> {
    return [...this.byId.values()].filter((t) => t.ownerId === ownerId).map((t) => structuredClone(t));
  }

  async listEnabled(): Promise<ScheduledTask[]> {
    return [...this.byId.values()].filter((t) => t.enabled).map((t) => structuredClone(t));
  }

  async delete(ownerId: string, id: string): Promise<void> {
    const t = this.byId.get(id);
    if (t && t.ownerId === ownerId) this.byId.delete(id);
  }
}

export class InMemoryNotificationRepository implements NotificationRepository {
  private readonly items: Notification[] = [];

  async create(n: Notification): Promise<void> {
    this.items.push(structuredClone(n));
  }

  async list(ownerId: string): Promise<Notification[]> {
    return this.items.filter((n) => n.ownerId === ownerId).map((n) => structuredClone(n));
  }

  async markRead(ownerId: string, id: string): Promise<void> {
    const n = this.items.find((x) => x.id === id && x.ownerId === ownerId);
    if (n) n.read = true;
  }
}

export class InMemoryAuditRepository implements AuditRepository {
  private readonly entries: AuditEntry[] = [];

  async record(entry: AuditEntry): Promise<void> {
    this.entries.push(structuredClone(entry));
  }

  async list(ownerId: string, taskId?: string): Promise<AuditEntry[]> {
    return this.entries
      .filter((e) => e.ownerId === ownerId && (taskId ? e.taskId === taskId : true))
      .map((e) => structuredClone(e));
  }
}

export class InMemoryMediaRepository implements MediaRepository {
  private readonly tasks = new Map<string, MediaTask>();

  async create(task: MediaTask): Promise<MediaTask> {
    this.tasks.set(task.id, structuredClone(task));
    return structuredClone(task);
  }

  async get(id: string): Promise<MediaTask | undefined> {
    const t = this.tasks.get(id);
    return t ? structuredClone(t) : undefined;
  }

  async save(task: MediaTask): Promise<void> {
    this.tasks.set(task.id, structuredClone(task));
  }

  async list(ownerId: string): Promise<MediaTask[]> {
    return [...this.tasks.values()].filter((t) => t.ownerId === ownerId).map((t) => structuredClone(t));
  }
}

export class InMemoryPluginRepository implements PluginRepository {
  private readonly byOwner = new Map<string, Map<string, Plugin>>();

  async install(ownerId: string, plugin: Plugin): Promise<void> {
    const map = this.byOwner.get(ownerId) ?? new Map();
    map.set(plugin.name, structuredClone(plugin));
    this.byOwner.set(ownerId, map);
  }

  async list(ownerId: string): Promise<Plugin[]> {
    return [...(this.byOwner.get(ownerId)?.values() ?? [])].map((p) => structuredClone(p));
  }

  async uninstall(ownerId: string, name: string): Promise<void> {
    this.byOwner.get(ownerId)?.delete(name);
  }

  async skillsFor(ownerId: string): Promise<SkillDef[]> {
    return (await this.list(ownerId)).flatMap((p) => p.skills);
  }
}

/** Combines built-in config skills + a user's saved skills + installed-plugin skills (S6-T1). */
export class CompositeSkillSource implements SkillSource {
  constructor(
    private readonly builtIns: SkillDef[],
    private readonly userSkills: SkillRepository,
    private readonly plugins?: { skillsFor(ownerId: string): Promise<SkillDef[]> },
  ) {}

  async list(ownerId?: string): Promise<SkillDef[]> {
    if (!ownerId) return [...this.builtIns];
    const user = await this.userSkills.list(ownerId);
    const fromPlugins = this.plugins ? await this.plugins.skillsFor(ownerId) : [];
    return [...this.builtIns, ...user, ...fromPlugins];
  }
}
