import { Connector, type Connector as ConnectorT } from '@apolla/contracts';
import type { ConnectorRepository } from '@apolla/harness-core';
import type { Sql } from './index';

/** Postgres ConnectorRepository — connector (incl. encrypted secrets) as JSONB, owner-indexed. */
export class PostgresConnectorRepository implements ConnectorRepository {
  constructor(private readonly sql: Sql) {}

  async save(connector: ConnectorT): Promise<ConnectorT> {
    await this.sql`
      INSERT INTO connectors (id, owner_id, data) VALUES (${connector.id}, ${connector.ownerId}, ${this.sql.json(connector)})
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
    `;
    return Connector.parse(connector);
  }

  async get(id: string): Promise<ConnectorT | undefined> {
    const rows = await this.sql<{ data: unknown }[]>`SELECT data FROM connectors WHERE id = ${id}`;
    return rows[0] ? Connector.parse(rows[0].data) : undefined;
  }

  async list(ownerId: string): Promise<ConnectorT[]> {
    const rows = await this.sql<{ data: unknown }[]>`SELECT data FROM connectors WHERE owner_id = ${ownerId} ORDER BY created_at`;
    return rows.map((r) => Connector.parse(r.data));
  }

  async delete(ownerId: string, id: string): Promise<void> {
    await this.sql`DELETE FROM connectors WHERE id = ${id} AND owner_id = ${ownerId}`;
  }
}
