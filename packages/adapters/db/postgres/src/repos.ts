import { randomUUID } from 'node:crypto';
import { User, Project, SkillDef, type User as UserT, type Project as ProjectT, type SkillDef as SkillDefT } from '@apolla/contracts';
import type { UserRepository, ProjectRepository, SkillRepository } from '@apolla/harness-core';
import type { Sql } from './index';

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly sql: Sql) {}

  async upsertByEmail(email: string): Promise<UserT> {
    const rows = await this.sql<{ id: string; email: string }[]>`
      INSERT INTO users (id, email) VALUES (${randomUUID()}, ${email})
      ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
      RETURNING id, email
    `;
    return User.parse(rows[0]);
  }

  async get(id: string): Promise<UserT | undefined> {
    const rows = await this.sql<{ id: string; email: string }[]>`SELECT id, email FROM users WHERE id = ${id}`;
    return rows[0] ? User.parse(rows[0]) : undefined;
  }
}

export class PostgresProjectRepository implements ProjectRepository {
  constructor(private readonly sql: Sql) {}

  async create(project: ProjectT): Promise<ProjectT> {
    await this.sql`
      INSERT INTO projects (id, owner_id, name, description)
      VALUES (${project.id}, ${project.ownerId}, ${project.name}, ${project.description})
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
    `;
    return Project.parse(project);
  }

  async get(id: string): Promise<ProjectT | undefined> {
    const rows = await this.sql<
      { id: string; owner_id: string; name: string; description: string }[]
    >`SELECT id, owner_id, name, description FROM projects WHERE id = ${id}`;
    const r = rows[0];
    return r ? Project.parse({ id: r.id, ownerId: r.owner_id, name: r.name, description: r.description }) : undefined;
  }

  async list(ownerId: string): Promise<ProjectT[]> {
    const rows = await this.sql<
      { id: string; owner_id: string; name: string; description: string }[]
    >`SELECT id, owner_id, name, description FROM projects WHERE owner_id = ${ownerId} ORDER BY created_at`;
    return rows.map((r) => Project.parse({ id: r.id, ownerId: r.owner_id, name: r.name, description: r.description }));
  }
}

export class PostgresSkillRepository implements SkillRepository {
  constructor(private readonly sql: Sql) {}

  async save(ownerId: string, def: SkillDefT): Promise<SkillDefT> {
    await this.sql`
      INSERT INTO skills (owner_id, name, data) VALUES (${ownerId}, ${def.name}, ${this.sql.json(def)})
      ON CONFLICT (owner_id, name) DO UPDATE SET data = EXCLUDED.data
    `;
    return SkillDef.parse(def);
  }

  async list(ownerId: string): Promise<SkillDefT[]> {
    const rows = await this.sql<{ data: unknown }[]>`SELECT data FROM skills WHERE owner_id = ${ownerId} ORDER BY created_at`;
    return rows.map((r) => SkillDef.parse(r.data));
  }

  async delete(ownerId: string, name: string): Promise<void> {
    await this.sql`DELETE FROM skills WHERE owner_id = ${ownerId} AND name = ${name}`;
  }
}
