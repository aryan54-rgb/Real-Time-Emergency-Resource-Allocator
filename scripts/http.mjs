// Tiny HTTP helper for the API-level test scripts.
export const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

// These scripts create cases and change resource counts. Refuse to touch a non-local server
// (e.g. the demo deployment) unless explicitly allowed.
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(BASE) && process.env.ALLOW_REMOTE_TESTS !== '1') {
  console.error(`Refusing to run data-modifying tests against ${BASE}. Set ALLOW_REMOTE_TESTS=1 to override, then run db:reset.`);
  process.exit(2);
}

export async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

export async function icu(hospitalId) {
  const { data } = await api('GET', '/api/state');
  return data.hospitals.find((h) => h.id === hospitalId).resources.find((r) => r.type === 'icu_bed');
}

let failures = 0;
export function check(cond, msg) {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`);
  if (!cond) failures++;
}
export function finish() {
  console.log(failures ? `\nFAILED (${failures} check(s))` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
}
