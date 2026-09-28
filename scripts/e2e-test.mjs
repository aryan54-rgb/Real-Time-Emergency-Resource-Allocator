// End-to-end flow through the HTTP API (server must be running, demo data seeded):
// create case -> rank -> reserve -> hospital rejects -> re-rank -> reserve next -> accept -> handover.
import { api, BASE, check, finish, icu } from './http.mjs';

console.log(`E2E flow against ${BASE}\n`);

// input validation
check((await api('POST', '/api/requests', { severity: 'critical', needs: ['teleporter'], lat: 1, lng: 1, patient_label: 'x' })).status === 400,
  'rejects unknown resource type with 400');
check((await api('POST', '/api/requests/not-a-uuid/reserve', { hospitalId: 'H1' })).status === 400, 'rejects malformed id with 400');

// 1. dispatcher creates a case near Akurdi needing an ICU bed + ventilator
const created = await api('POST', '/api/requests', {
  patient_label: 'e2e-patient', severity: 'critical', needs: ['icu_bed', 'ventilator'], lat: 18.645, lng: 73.77,
});
check(created.status === 200 && created.data.status === 'pending', 'case created as pending');
const id = created.data.id;

// 2. ranking
const rank1 = (await api('GET', `/api/requests/${id}/rank`)).data;
const first = rank1.find((r) => r.reservable);
check(Array.isArray(rank1) && rank1.length >= 5, `ranked ${rank1.length} hospitals`);
check(rank1.every((r, i) => i === 0 || !r.reservable || rank1[i - 1].reservable), 'reservable hospitals listed first');
check(rank1.filter((r) => !r.reservable).every((r) => r.missing.length > 0), 'non-reservable hospitals report what is missing');
console.log(`     top pick: ${first.hospitalId} (score ${first.score.toFixed(2)}, ETA ~${Math.round(first.etaMin)} min)`);

// 3. reserve at top pick -> resources held
const before1 = await icu(first.hospitalId);
const r1 = await api('POST', `/api/requests/${id}/reserve`, { hospitalId: first.hospitalId });
check(r1.status === 200 && r1.data.status === 'reserved', `reserved at ${first.hospitalId}`);
check((await icu(first.hospitalId)).available === before1.available - 1, 'ICU count decremented by the hold');

// a different hospital cannot answer, and handover before acceptance is refused
check((await api('POST', `/api/requests/${id}/respond`, { hospitalId: 'H6', accept: true })).status === 409, 'other hospital cannot accept');
check((await api('POST', `/api/requests/${id}/handover`, { hospitalId: first.hospitalId })).status === 409, 'handover refused before acceptance');

// 4. hospital rejects -> hold released, case back to pending
const rej = await api('POST', `/api/requests/${id}/respond`, { hospitalId: first.hospitalId, accept: false, note: 'ICU staff unavailable' });
check(rej.status === 200 && rej.data.status === 'pending', 'hospital rejected, case back to pending');
check((await icu(first.hospitalId)).available === before1.available, 'rejection released the ICU bed');

// 5. re-rank: rejecting hospital no longer reservable; reserve next
const rank2 = (await api('GET', `/api/requests/${id}/rank`)).data;
check(rank2.find((r) => r.hospitalId === first.hospitalId).reservable === false, 'rejecting hospital excluded on re-rank');
check((await api('POST', `/api/requests/${id}/reserve`, { hospitalId: first.hospitalId })).status === 409, 'cannot re-reserve at rejecting hospital');
const second = rank2.find((r) => r.reservable);
const before2 = await icu(second.hospitalId);
check((await api('POST', `/api/requests/${id}/reserve`, { hospitalId: second.hospitalId })).status === 200, `rerouted and reserved at ${second.hospitalId}`);

// 6. hospital accepts, 7. handover
const acc = await api('POST', `/api/requests/${id}/respond`, { hospitalId: second.hospitalId, accept: true });
check(acc.status === 200 && acc.data.status === 'accepted', 'hospital accepted');
const ho = await api('POST', `/api/requests/${id}/handover`, { hospitalId: second.hospitalId });
check(ho.status === 200 && ho.data.status === 'handed_over', 'patient handed over');
check((await icu(second.hospitalId)).available === before2.available - 1, 'ICU bed stays occupied after handover');
check((await api('POST', `/api/requests/${id}/cancel`)).status === 409, 'handed-over case cannot be cancelled');

// hospital staff update + clamp
const current = (await icu(second.hospitalId)).available;
const stale = await api('POST', `/api/hospitals/${second.hospitalId}/resources`, { type: 'icu_bed', expected: current + 1, available: current + 2 });
check(stale.status === 409 && stale.data.error === 'STALE_COUNT', 'staff update based on a stale count is refused (409 STALE_COUNT)');
check((await icu(second.hospitalId)).available === current, 'refused stale update left the count unchanged');
const set = await api('POST', `/api/hospitals/${second.hospitalId}/resources`, { type: 'icu_bed', expected: current, available: 999 });
check(set.status === 200 && set.data.available === set.data.total, 'availability update is clamped to total');
await api('POST', `/api/hospitals/${second.hospitalId}/resources`, { type: 'icu_bed', expected: set.data.available, available: current });

// active cases must stay visible no matter how much closed history piles up
const keep = await api('POST', '/api/requests', { patient_label: 'e2e-still-active', severity: 'serious', needs: ['general_bed'], lat: 18.6, lng: 73.8 });
const noise = await Promise.all(Array.from({ length: 40 }, (_, i) => api('POST', '/api/requests', {
  patient_label: `e2e-noise-${i}`, severity: 'stable', needs: ['general_bed'], lat: 18.6, lng: 73.8 })));
await Promise.all(noise.map((n) => api('POST', `/api/requests/${n.data.id}/cancel`)));
const st = (await api('GET', '/api/state')).data;
check(st.requests.some((r) => r.id === keep.data.id), 'active case still listed after 40 newer closed cases');
check(st.requests.filter((r) => r.status === 'cancelled').length <= 30, 'closed history is capped');
check((await api('GET', `/api/requests/${keep.data.id}/rank`)).status === 200, 'ranking works for that case');
await api('POST', `/api/requests/${keep.data.id}/cancel`);

// unknown hospital / out-of-range input -> 4xx, not 500
const c2 = await api('POST', '/api/requests', { patient_label: 'e2e-x', severity: 'stable', needs: ['general_bed'], lat: 18.6, lng: 73.8 });
check((await api('POST', `/api/requests/${c2.data.id}/reserve`, { hospitalId: 'H99' })).status === 404, 'reserve at unknown hospital -> 404');
check((await api('POST', '/api/hospitals/H1/resources', { type: 'icu_bed', expected: 0, available: 1e12 })).status === 400, 'out-of-range count -> 400');
await api('POST', `/api/requests/${c2.data.id}/cancel`);

finish();
