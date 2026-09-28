// Starts a throwaway real PostgreSQL for the test run.
import EmbeddedPostgres from 'embedded-postgres';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../scripts/db-tools.mjs';

export default async function setup({ provide }) {
  const port = 54330;
  const pg = new EmbeddedPostgres({
    databaseDir: join(tmpdir(), `pulseroute-test-pg-${process.pid}`),
    user: 'postgres', password: 'postgres', port, persistent: false, onLog: () => {},
  });
  await pg.initialise();
  await pg.start();
  const client = pg.getPgClient();
  await client.connect();
  await migrate(client);
  await client.end();
  provide('databaseUrl', `postgres://postgres:postgres@localhost:${port}/postgres`);
  return async () => { await pg.stop(); };
}
