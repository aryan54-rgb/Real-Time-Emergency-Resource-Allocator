// Double-booking test through the real HTTP API (server must be running).
// Each round: H1 gets exactly ONE free ICU bed, two cases fire "reserve at H1" at the same instant.
// Exactly one must get 200 and the other 409 RESOURCE_UNAVAILABLE.
//   BASE_URL=http://localhost:3000 ROUNDS=10 npm run test:race
import { api, BASE, check, finish, icu } from './http.mjs';

const ROUNDS = Number(process.env.ROUNDS ?? 10);
const HOSPITAL = 'H1';
console.log(`Race test against ${BASE}: ${ROUNDS} rounds, 2 simultaneous requests for the last ICU bed at ${HOSPITAL}\n`);

const original = await icu(HOSPITAL);
for (let round = 1; round <= ROUNDS; round++) {
  await api('POST', `/api/hospitals/${HOSPITAL}/resources`, { type: 'icu_bed', expected: (await icu(HOSPITAL)).available, available: 1 });
  const mk = (tag) => api('POST', '/api/requests', {
    patient_label: `race-${round}-${tag}`, severity: 'critical', needs: ['icu_bed'], lat: 18.645, lng: 73.77,
  });
  const [a, b] = await Promise.all([mk('A'), mk('B')]);

  const results = await Promise.all([a, b].map((r) =>
    api('POST', `/api/requests/${r.data.id}/reserve`, { hospitalId: HOSPITAL })));

  const wins = results.filter((r) => r.status === 200).length;
  const conflicts = results.filter((r) => r.status === 409 && r.data.error === 'RESOURCE_UNAVAILABLE').length;
  const after = await icu(HOSPITAL);
  check(wins === 1 && conflicts === 1 && after.available === 0,
    `round ${round}: statuses [${results.map((r) => r.status)}] -> ${wins} success, ${conflicts} conflict, ICU left ${after.available}`);

  await Promise.all([a, b].map((r) => api('POST', `/api/requests/${r.data.id}/cancel`)));
}
await api('POST', `/api/hospitals/${HOSPITAL}/resources`, { type: 'icu_bed', expected: (await icu(HOSPITAL)).available, available: original.available });
finish();
