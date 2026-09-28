// Runs a real local PostgreSQL (no Docker / no Supabase account needed), applies the
// migrations and seeds demo data. Keep this running while you use `npm run dev`.
//   DATABASE_URL=postgres://postgres:postgres@localhost:54329/postgres
import EmbeddedPostgres from 'embedded-postgres';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate, seed } from './db-tools.mjs';

const port = Number(process.env.LOCAL_PG_PORT ?? 54329);
// Postgres needs a POSIX filesystem for its data dir (it fails on Windows-mounted drives in WSL).
const databaseDir = process.env.LOCAL_PG_DIR ?? join(tmpdir(), 'pulseroute-pg');

const pg = new EmbeddedPostgres({ databaseDir, user: 'postgres', password: 'postgres', port, persistent: false, onLog: () => {} });
await pg.initialise();
await pg.start();

const client = pg.getPgClient();
await client.connect();
await migrate(client);
await seed(client);
await client.end();

console.log(`Local PostgreSQL ready with demo data.\n  DATABASE_URL=postgres://postgres:postgres@localhost:${port}/postgres\nPress Ctrl+C to stop (data is discarded).`);

const stop = async () => { await pg.stop(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
