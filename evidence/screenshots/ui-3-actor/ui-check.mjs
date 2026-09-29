// Browser check of the 3-actor UI flow against a throwaway DB + the production build.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const APP = '/mnt/d/ARYAN/hackmatrix/pulseroute';
const req = createRequire(APP + '/package.json');
const EmbeddedPostgres = req('embedded-postgres').default;
const pg = req('pg');
const { migrate, seed } = await import(APP + '/scripts/db-tools.mjs');

const PG_PORT = 54341, APP_PORT = 3211;
const DATABASE_URL = `postgres://postgres:postgres@localhost:${PG_PORT}/postgres`;
const BASE = `http://localhost:${APP_PORT}`;
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (ok, name) => { results.push({ ok, name }); console.log(`${ok ? '  ✓' : '  ✗'} ${name}`); };

const db = new EmbeddedPostgres({ databaseDir: join(tmpdir(), `pr-ui-${process.pid}`), user: 'postgres', password: 'postgres', port: PG_PORT, persistent: false, onLog: () => {} });
let server, browser;
try {
  await db.initialise(); await db.start();
  const c = new pg.Client({ connectionString: DATABASE_URL }); await c.connect();
  await migrate(c); await seed(c); await c.end();

  server = spawn('npx', ['next', 'start', '-p', String(APP_PORT)], { cwd: APP, env: { ...process.env, DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_ANON_KEY: '' }, stdio: 'ignore' });
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`${BASE}/api/state`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
  const state = async () => (await fetch(`${BASE}/api/state`)).json();

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });

  // ---- Dispatcher: AI call co-pilot ----
  const d = await ctx.newPage();
  await d.goto(`${BASE}/dispatcher`);
  await d.getByRole('button', { name: 'Accept 108 Call' }).click();
  await d.waitForSelector('.transcript-line >> nth=3');
  await d.screenshot({ path: `${OUT}/01-dispatcher-live-transcript.png` });
  check(await d.locator('.kw-critical').count() >= 2, 'transcript streams in and highlights critical keywords');
  check(await d.locator('.kw-location').count() >= 1, 'location keyword highlighted');
  const verifyBtn = d.getByRole('button', { name: 'Verify AI & Find Hospitals' });
  await verifyBtn.waitFor({ timeout: 8000 });
  check((await d.locator('.seg-on').textContent())?.trim() === 'critical', 'severity auto-filled: critical');
  const onChips = (await d.locator('.chip-on').allTextContents()).map((s) => s.trim()).sort();
  check(JSON.stringify(onChips) === JSON.stringify(['Cardiac unit', 'ICU bed']), `needs auto-filled: ${onChips.join(' + ')}`);
  check(/Pin dropped/.test(await d.locator('.pin-hint').textContent()), 'map pin auto-dropped');
  await d.screenshot({ path: `${OUT}/02-dispatcher-ai-extraction.png` });

  const nBefore = (await state()).requests.length;
  await verifyBtn.click();
  await d.waitForSelector('.rank-card');
  const s1 = await state();
  const kase = s1.requests.find((r) => r.patient_label.startsWith('Male'));
  check(s1.requests.length === nBefore + 1 && kase?.status === 'pending', 'Verify creates a pending case via the API');
  check(kase?.severity === 'critical' && kase.needs.slice().sort().join() === 'cardiac_unit,icu_bed', 'case stored with AI-suggested severity + needs');
  await d.screenshot({ path: `${OUT}/03-dispatcher-ranked.png` });

  await d.locator('.rank-card .btn-primary:not([disabled])').first().click();
  await d.waitForSelector('.flash-ok');
  const s2 = await state();
  const reserved = s2.requests.find((r) => r.id === kase.id);
  check(reserved.status === 'reserved', `reserved at ${reserved.hospital_id}`);
  check(await d.getByText('Open ambulance crew view').count() === 1, 'dispatcher shows link to crew view');

  // ---- Hospital: light theme + big accept ----
  const h = await ctx.newPage();
  await h.goto(`${BASE}/hospital/${reserved.hospital_id}`);
  await h.waitForSelector('.incoming-zone-active .btn-accept');
  const bg = await h.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check(/rgb\(244, 246, 250\)/.test(bg), `hospital page uses light palette (${bg})`);
  const box = await h.locator('.btn-accept').boundingBox();
  check(box.height >= 70, `ACCEPT button is ${Math.round(box.height)}px tall`);
  check(await h.getByRole('button', { name: /Confirm patient handover/i }).count() === 0, 'hospital no longer has a handover button');
  await h.screenshot({ path: `${OUT}/04-hospital-incoming.png` });
  await h.locator('.btn-accept').click();
  await h.waitForSelector('.flash-ok');
  check((await state()).requests.find((r) => r.id === kase.id).status === 'accepted', 'hospital accept recorded');
  await h.screenshot({ path: `${OUT}/05-hospital-en-route.png` });

  // ---- Ambulance crew view ----
  const a = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  await a.goto(`${BASE}/ambulance/${kase.id}`);
  await a.waitForSelector('.amb-status-accepted');
  const phoneW = (await a.locator('.phone').boundingBox()).width;
  check(phoneW <= 400.5, `phone frame width ${Math.round(phoneW)}px`);
  const hosp = s2.hospitals.find((x) => x.id === reserved.hospital_id);
  check((await a.locator('.amb-dest h1').textContent()) === hosp.name, `destination shown: ${hosp.name}`);
  check(await a.locator('.amb-eta-value').count() === 1, `ETA shown: ${(await a.locator('.amb-eta-value').textContent()).trim()}`);
  await a.screenshot({ path: `${OUT}/06-ambulance-en-route.png` });
  await a.getByRole('button', { name: 'Confirm Patient Handover' }).click();
  await a.waitForSelector('.amb-done');
  check((await state()).requests.find((r) => r.id === kase.id).status === 'handed_over', 'crew handover recorded (status handed_over)');
  await a.screenshot({ path: `${OUT}/07-ambulance-handover-done.png` });

  // mobile width: bezel dropped
  const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto(`${BASE}/ambulance/${kase.id}`);
  await m.waitForSelector('.amb-done');
  check((await m.locator('.phone').evaluate((el) => getComputedStyle(el).borderTopWidth)) === '0px', 'on a 390px phone the mock bezel is dropped');
  await m.screenshot({ path: `${OUT}/08-ambulance-phone-width.png` });
} catch (e) {
  check(false, `crashed: ${e.message.split('\n')[0]}`);
} finally {
  await browser?.close();
  server?.kill();
  await db.stop().catch(() => {});
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} UI checks passed`);
  process.exit(failed ? 1 : 0);
}
