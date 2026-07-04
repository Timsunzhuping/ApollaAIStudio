import { ProductEvent, type ProductEvent as ProductEventT } from '@apolla/contracts';
import type { ProductEventRepository } from '@apolla/harness-core';
import type { Sql } from './index';

/** Postgres ProductEventRepository — append-only event log the north star is derived from (S29). */
export class PostgresProductEventRepository implements ProductEventRepository {
  constructor(private readonly sql: Sql) {}

  async record(event: ProductEventT): Promise<void> {
    await this.sql`
      INSERT INTO product_events (id, owner_id, at, data)
      VALUES (${event.id}, ${event.ownerId}, ${event.at}, ${this.sql.json(event)})
      ON CONFLICT (id) DO NOTHING
    `;
  }

  async listSince(sinceIso: string): Promise<ProductEventT[]> {
    const rows = await this.sql<{ data: unknown }[]>`
      SELECT data FROM product_events WHERE at >= ${sinceIso} ORDER BY at
    `;
    return rows.map((r) => ProductEvent.parse(r.data));
  }
}
