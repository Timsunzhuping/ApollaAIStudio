import { InMemoryTaskRepository } from '@apolla/harness-core';
import { runTaskRepositoryContract } from './contract';
import { PostgresTaskRepository, createSql, migrate, type Sql } from './index';

// In-memory always runs — proves the shared contract and that the reference impl conforms.
runTaskRepositoryContract('in-memory', {
  fresh: async () => new InMemoryTaskRepository(),
});

// Postgres runs only when DATABASE_URL is set (CI service container / local docker).
const url = process.env.DATABASE_URL;
let sql: Sql | undefined;
if (url) sql = createSql(url);

runTaskRepositoryContract('postgres', {
  skip: !sql,
  fresh: async () => {
    await migrate(sql!);
    await sql!`TRUNCATE tasks`;
    return new PostgresTaskRepository(sql!);
  },
  teardown: async () => {
    await sql?.end();
  },
});
