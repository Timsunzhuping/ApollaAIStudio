import { createSql, migrate } from './index';

/** CLI: `pnpm --filter @apolla/db-postgres migrate` (reads DATABASE_URL). */
const sql = createSql();
await migrate(sql);
await sql.end();
console.log('migrated: tasks');
