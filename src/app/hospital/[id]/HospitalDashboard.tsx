'use client';
import Link from 'next/link';
import { useState } from 'react';
import { SimBadge } from '@/components/SimBadge';
import { SyncBadge } from '@/components/SyncBadge';
import { StatusPill } from '@/components/StatusPill';
import { formatAge, minutesAgo, post } from '@/lib/client';
import { STALE_AFTER_MIN } from '@/lib/ranking';
import { RESOURCE_LABELS, type EmergencyRequest, type Resource } from '@/lib/types';
import { useLiveState } from '@/lib/useLiveState';

export function HospitalDashboard({ hospitalId }: { hospitalId: string }) {
  const { state, error, mode, refresh, now } = useLiveState();
  const [flash, setFlash] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const hospital = state?.hospitals.find((h) => h.id === hospitalId);
  const mine = (state?.requests ?? []).filter((r) => r.hospital_id === hospitalId);
  const incoming = mine.filter((r) => r.status === 'reserved');
  const enRoute = mine.filter((r) => r.status === 'accepted');
  const done = mine.filter((r) => r.status === 'handed_over').slice(0, 5);

  const show = (kind: 'ok' | 'bad', text: string) => {
    const f = { kind, text };
    setFlash(f);
    setTimeout(() => setFlash((cur) => (cur === f ? null : cur)), 6000);
  };

  async function act(url: string, payload: object, okText: string) {
    setBusy(true);
    const r = await post(url, payload);
    setBusy(false);
    await refresh();
    show(r.ok ? 'ok' : 'bad', r.ok ? okText : r.message);
  }

  const setAvail = (res: Resource, available: number) =>
    act(`/api/hospitals/${hospitalId}/resources`, { type: res.type, expected: res.available, available },
      `${RESOURCE_LABELS[res.type]} availability ${available === res.available ? 'confirmed' : 'updated'}.`);
  const respond = (r: EmergencyRequest, accept: boolean) =>
    act(`/api/requests/${r.id}/respond`, { hospitalId, accept, note: notes[r.id] ?? '' },
      accept ? `Accepted ${r.patient_label}.` : `Rejected ${r.patient_label}; resources released.`);
  const handover = (r: EmergencyRequest) =>
    act(`/api/requests/${r.id}/handover`, { hospitalId }, `Handover of ${r.patient_label} recorded.`);

  if (state && !hospital) {
    return (
      <main className="page">
        <p>Unknown hospital “{hospitalId}”. <Link href="/">Back</Link></p>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="topbar">
        <Link href="/" className="brand"><span>Pulse</span>Route</Link>
        <h1>{hospital?.name ?? 'Hospital'} <span className="muted small">({hospitalId})</span></h1>
        {state && <SimBadge hospitals={state.hospitals} now={now} />}
        <SyncBadge mode={mode} error={error} />
      </header>

      {flash && <div className={`flash flash-${flash.kind}`} role="status">{flash.text}</div>}

      <div className="hospital-grid">
        <section className="panel">
          <h2>Incoming requests ({incoming.length})</h2>
          {incoming.length === 0 && <p className="muted">No requests awaiting your decision.</p>}
          {incoming.map((r) => (
            <div key={r.id} className="incoming">
              <div className="case-head">
                <strong>{r.patient_label}</strong>
                <span className={`sev sev-${r.severity}`}>{r.severity}</span>
              </div>
              <p className="small">Needs {r.needs.map((n) => RESOURCE_LABELS[n]).join(' + ')} · requested {formatAge(minutesAgo(r.updated_at, now))}</p>
              <p className="muted small">These units are already held for this patient. Rejecting releases them.</p>
              <input placeholder="Note (optional, e.g. reason for rejection)" value={notes[r.id] ?? ''} maxLength={200}
                onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} />
              <div className="row">
                <button className="btn btn-primary" disabled={busy} onClick={() => respond(r, true)}>Accept</button>
                <button className="btn btn-ghost" disabled={busy} onClick={() => respond(r, false)}>Reject</button>
              </div>
            </div>
          ))}

          <h2>En route ({enRoute.length})</h2>
          {enRoute.length === 0 && <p className="muted">No accepted patients en route.</p>}
          {enRoute.map((r) => (
            <div key={r.id} className="incoming">
              <div className="case-head"><strong>{r.patient_label}</strong><StatusPill status={r.status} /></div>
              <p className="small">Needs {r.needs.map((n) => RESOURCE_LABELS[n]).join(' + ')}</p>
              <button className="btn btn-primary" disabled={busy} onClick={() => handover(r)}>Confirm patient handover</button>
            </div>
          ))}

          {done.length > 0 && (
            <>
              <h3>Recent handovers</h3>
              <ul className="case-list">
                {done.map((r) => <li key={r.id} className="case case-closed"><div className="case-head"><span>{r.patient_label}</span><StatusPill status={r.status} /></div></li>)}
              </ul>
            </>
          )}
        </section>

        <section className="panel">
          <h2>Resource availability</h2>
          <p className="muted small">Update counts as they change, or press Confirm if they are still correct. Counts not confirmed for {STALE_AFTER_MIN} min are flagged as stale to dispatchers. Reservations adjust counts automatically. Changes tagged SIM come from the demo simulator and do not count as confirmations.</p>
          <table className="res">
            <thead><tr><th>Resource</th><th>Available</th><th>Total</th><th>Last confirmed</th><th /></tr></thead>
            <tbody>
              {hospital?.resources.map((res) => {
                const age = minutesAgo(res.updated_at, now);
                return (
                  <tr key={res.type}>
                    <td className="strong">{RESOURCE_LABELS[res.type]}</td>
                    <td className={res.available === 0 ? 'bad strong' : 'strong'}>{res.available}</td>
                    <td>{res.total}</td>
                    <td>
                      <span className={age > STALE_AFTER_MIN ? 'warn' : ''}>{formatAge(age)}</span>
                      {res.sim_changed_at && (
                        <div className="sim-note" title="Changed by the demo simulator, not confirmed by staff">
                          <span className="sim-tag">SIM</span> {res.sim_delta && res.sim_delta > 0 ? '+' : ''}{res.sim_delta} · {formatAge(minutesAgo(res.sim_changed_at, now))}
                        </div>
                      )}
                    </td>
                    <td className="row">
                      <button className="btn btn-small" aria-label="decrease" disabled={busy || res.available <= 0} onClick={() => setAvail(res, res.available - 1)}>−</button>
                      <button className="btn btn-small" aria-label="increase" disabled={busy || res.available >= res.total} onClick={() => setAvail(res, res.available + 1)}>+</button>
                      <button className="btn btn-small btn-ghost" disabled={busy} onClick={() => setAvail(res, res.available)} title="Confirm the count is still correct">Confirm</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
