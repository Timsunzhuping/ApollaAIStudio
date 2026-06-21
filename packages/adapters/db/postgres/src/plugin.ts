import { Plugin, type Plugin as PluginT, type SkillDef as SkillDefT } from '@apolla/contracts';
import type { PluginRepository } from '@apolla/harness-core';
import type { Sql } from './index';

/** Postgres PluginRepository — installed plugins per owner stored as JSONB (S6-T1). */
export class PostgresPluginRepository implements PluginRepository {
  constructor(private readonly sql: Sql) {}

  async install(ownerId: string, plugin: PluginT): Promise<void> {
    await this.sql`
      INSERT INTO plugins (owner_id, name, data) VALUES (${ownerId}, ${plugin.name}, ${this.sql.json(plugin)})
      ON CONFLICT (owner_id, name) DO UPDATE SET data = EXCLUDED.data
    `;
  }

  async list(ownerId: string): Promise<PluginT[]> {
    const rows = await this.sql<{ data: unknown }[]>`SELECT data FROM plugins WHERE owner_id = ${ownerId} ORDER BY name`;
    return rows.map((r) => Plugin.parse(r.data));
  }

  async uninstall(ownerId: string, name: string): Promise<void> {
    await this.sql`DELETE FROM plugins WHERE owner_id = ${ownerId} AND name = ${name}`;
  }

  async skillsFor(ownerId: string): Promise<SkillDefT[]> {
    return (await this.list(ownerId)).flatMap((p) => p.skills);
  }
}
