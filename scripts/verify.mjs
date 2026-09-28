// One-command verification for submission evidence. Self-contained: starts a throwaway
// PostgreSQL + the production server on separate ports (does not touch your dev database),
// runs every suite, and writes evidence/VERIFICATION.md.
//   npm run verify            (always rebuilds, so the report matches the current code)
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { migrate, seed } from './db-tools.mjs';

const PG_PORT = 54331, APP_PORT = 3201;
const DATABASE_URL = `postgres://postgres:postgres@localhost:${PG_PORT}/postgres`;
const BASE_URL = `http://localhost:${APP_PORT}`;
const RACE_ROUNDS = process.env.ROUNDS ?? '25';

function run(cmd, args, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...env }, shell: process.platform === 'win32' });
    let out = '';
    p.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
    p.stderr.on('data', (d) => { out += d; process.stderr.write(d); });
    p.on('close', (code) => resolve({ code, out }));
  });
}
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

const results = [];
async function step(name, cmd, args, env) {
  console.log(`\n=== ${name} ===`);
  const t0 = Date.now();
  const r = await run(cmd, args, env);
  results.push({ name, ok: r.code === 0, secs: ((Date.now() - t0) / 1000).toFixed(1), out: strip(r.out).trim() });
  return r.code === 0;
}

const database = new EmbeddedPostgres({
  databaseDir: join(tmpdir(), `pulseroute-verify-${process.pid}`),
  user: 'postgres', password: 'postgres', port: PG_PORT, persistent: false, onLog: () => {},
});
let server;
try {
  await step('Typecheck', 'npx', ['tsc', '--noEmit']);
  await step('Unit + database tests (vitest)', 'npx', ['vitest', 'run']);
  if (!(await step('Production build', 'npx', ['next', 'build']))) throw new Error('build failed');

  await database.initialise();
  await database.start();
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  await migrate(client);

  const env = { DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_ANON_KEY: '' };
  server = spawn('npx', ['next', 'start', '-p', String(APP_PORT)], { env: { ...process.env, ...env }, stdio: 'ignore' });
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE_URL}/api/state`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }

  await seed(client);
  await step(`HTTP race test (${RACE_ROUNDS} rounds)`, 'node', ['scripts/race-test.mjs'], { BASE_URL, ROUNDS: RACE_ROUNDS });
  await seed(client);
  await step('HTTP end-to-end flow', 'node', ['scripts/e2e-test.mjs'], { BASE_URL });
  await client.end();
} catch (e) {
  results.push({ name: 'Runner', ok: false, secs: '-', out: String(e?.stack ?? e) });
} finally {
  server?.kill();
  await database.stop().catch(() => {});
}

const allOk = results.every((r) => r.ok);
mkdirSync('evidence', { recursive: true });
const md = [
  '# PulseRoute — verification run',
  '',
  `- Date: ${new Date().toISOString()}`,
  `- Node ${process.version} · ${process.platform}`,
  `- Result: **${allOk ? 'ALL PASSED' : 'FAILURES'}**`,
  '',
  '| Step | Result | Time |',
  '|---|---|---|',
  ...results.map((r) => `| ${r.name} | ${r.ok ? 'PASS' : '**FAIL**'} | ${r.secs}s |`),
  '',
  ...results.flatMap((r) => [`## ${r.name}`, '', '```', r.out.split('\n').slice(-60).join('\n') || '(no output)', '```', '']),
].join('\n');
writeFileSync('evidence/VERIFICATION.md', md);
console.log(`\n${allOk ? 'ALL PASSED' : 'FAILURES'} — report written to evidence/VERIFICATION.md`);
process.exit(allOk ? 0 : 1);
