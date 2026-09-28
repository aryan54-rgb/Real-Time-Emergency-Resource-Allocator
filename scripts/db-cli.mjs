// `node scripts/db-cli.mjs migrate|seed|reset` against DATABASE_URL (Supabase or any Postgres).
import pg from 'pg';
import { migrate, seed } from './db-tools.mjs';

const cmd = process.argv[2];
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set (see .env.example).');
  process.exit(1);
}
const client = new pg.Client({ connectionString: url, ssl: url.includes('localhost') ? false : { rejectUnauthorized: false } });
await client.connect();
try {
  if (cmd === 'migrate' || cmd === 'reset') await migrate(client);
  if (cmd === 'seed' || cmd === 'reset') await seed(client);
  if (!['migrate', 'seed', 'reset'].includes(cmd)) throw new Error(`unknown command "${cmd}"`);
  console.log(`db ${cmd}: done`);
} finally {
  await client.end();
}
