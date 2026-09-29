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

// Presentation only: how full a resource looks (derived from the live count, no extra data).
function level(res: Resource): 'none' | 'low' | 'ok' {
  if (res.available <= 0) return 'none';
  if (res.available === 1 || res.available / Math.max(res.total, 1) <= 0.2) return 'low';
  return 'ok';
}
const LEVEL_TEXT = { none: 'None free', low: 'Limited', ok: 'Available' } as const;

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

  if (state && !hospital) {
    return (
      <main className="page theme-light">
        <p>Unknown hospital “{hospitalId}”. <Link href="/">Back</Link></p>
      </main>
    );
  }

  // Summary figures, all computed from the live resource rows above.
  const resources = hospital?.resources ?? [];
  const icu = resources.find((r) => r.type === 'icu_bed');
  const unavailable = resources.filter((r) => r.available <= 0).length;
  const oldestConfirmMin = resources.length ? Math.max(...resources.map((r) => minutesAgo(r.updated_at, now))) : null;
  const staleCount = resources.filter((r) => minutesAgo(r.updated_at, now) > STALE_AFTER_MIN).length;

  return (
    <main className="page theme-light">
      <header className="topbar">
        <Link href="/" className="brand"><span>Pulse</span>Route</Link>
        <div className="topbar-title">
          <span className="eyebrow">Hospital console</span>
          <h1>
            {hospital?.name ?? 'Loading hospital…'}
            <span className="id-chip">{hospitalId}</span>
          </h1>
          {hospital?.address && <span className="subtle">{hospital.address}</span>}
        </div>
        <div className="topbar-status">
          {state && <SimBadge hospitals={state.hospitals} now={now} />}
          <SyncBadge mode={mode} error={error} />
        </div>
      </header>

      {flash && <div className={`flash flash-${flash.kind}`} role="status">{flash.text}</div>}

      <section className={`panel incoming-zone ${incoming.length ? 'incoming-zone-active' : ''}`} aria-live="polite">
        <div className="panel-head">
          <h2>{incoming.length ? 'Incoming patients: decision needed' : 'Incoming requests'}</h2>
          <span className={`count ${incoming.length ? 'count-alert' : ''}`}>{incoming.length}</span>
        </div>
        {incoming.length === 0 && (
          <div className="empty empty-compact">
            <span className="empty-icon" aria-hidden>⇣</span>
            <div>
              <strong>No requests awaiting your decision</strong>
              <p>When a dispatcher reserves units here, the request appears at the top of this page instantly.</p>
            </div>
          </div>
        )}
        {incoming.length > 0 && (
          <div className="incoming-grid">
            {incoming.map((r) => (
              <article key={r.id} className="req req-incoming">
                <div className="req-head">
                  <strong className="req-title">{r.patient_label}</strong>
                  <span className={`sev-chip sev-${r.severity}`}>{r.severity}</span>
                </div>
                <div className="need-chips">
                  {r.needs.map((n) => <span key={n} className="need-chip">{RESOURCE_LABELS[n]}</span>)}
                  <span className="subtle">requested {formatAge(minutesAgo(r.updated_at, now))}</span>
                </div>
                <p className="req-note">These units are already held for this patient. Rejecting releases them.</p>
                <input placeholder="Note (optional, e.g. reason for rejection)" value={notes[r.id] ?? ''} maxLength={200}
                  onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} />
                <div className="decision">
                  <button className="btn btn-xl btn-accept" disabled={busy} onClick={() => respond(r, true)}>✓ Accept</button>
                  <button className="btn btn-xl btn-reject" disabled={busy} onClick={() => respond(r, false)}>✕ Reject</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="kpis" aria-label="Summary">
        <div className={`kpi ${incoming.length ? 'kpi-alert' : ''}`}>
          <span className="kpi-label">Awaiting decision</span>
          <span className="kpi-value">{incoming.length}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Patients en route</span>
          <span className="kpi-value">{enRoute.length}</span>
        </div>
        {icu && (
          <div className={`kpi ${icu.available === 0 ? 'kpi-bad' : ''}`}>
            <span className="kpi-label">ICU beds free</span>
            <span className="kpi-value">{icu.available}<small> / {icu.total}</small></span>
          </div>
        )}
        <div className={`kpi ${unavailable ? 'kpi-bad' : ''}`}>
          <span className="kpi-label">Resource types at zero</span>
          <span className="kpi-value">{unavailable}<small> of {resources.length}</small></span>
        </div>
        <div className={`kpi ${staleCount ? 'kpi-warn' : ''}`}>
          <span className="kpi-label">Oldest staff confirmation</span>
          <span className="kpi-value kpi-value-text">{oldestConfirmMin === null ? '—' : formatAge(oldestConfirmMin)}</span>
          {staleCount > 0 && <span className="kpi-note">{staleCount} stale (&gt;{STALE_AFTER_MIN} min)</span>}
        </div>
      </section>

      <div className="hospital-grid">
        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <h2>Patients en route</h2>
              <span className="count">{enRoute.length}</span>
            </div>
            {enRoute.length === 0 && (
              <div className="empty">
                <span className="empty-icon" aria-hidden>→</span>
                <div>
                  <strong>No accepted patients en route</strong>
                  <p>Accepted requests move here until the ambulance crew confirms handover; the held units then stay occupied.</p>
                </div>
              </div>
            )}
            {enRoute.map((r) => (
              <article key={r.id} className="req">
                <div className="req-head">
                  <strong className="req-title">{r.patient_label}</strong>
                  <StatusPill status={r.status} />
                </div>
                <div className="need-chips">
                  {r.needs.map((n) => <span key={n} className="need-chip">{RESOURCE_LABELS[n]}</span>)}
                  <span className="subtle">accepted {formatAge(minutesAgo(r.updated_at, now))}</span>
                </div>
                <p className="req-note">The ambulance crew confirms handover on arrival. <Link href={`/ambulance/${r.id}`} target="_blank">Crew view ↗</Link></p>
              </article>
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
        </div>

        <section className="panel">
          <div className="panel-head">
            <h2>Live resource availability</h2>
          </div>
          <div className="ts-legend">
            <span><span className="tag tag-staff">Staff confirmed</span> Count verified by hospital staff. Drives data freshness for dispatchers; stale after {STALE_AFTER_MIN} min.</span>
            <span><span className="tag tag-sim">Live simulation</span> Change made by the demo simulator. Not a staff confirmation.</span>
            <span className="subtle">Reservations adjust counts automatically. Press Confirm if a count is still correct.</span>
          </div>

          {!hospital && <div className="loading-block">{error ? `Cannot load data: ${error}` : 'Loading live data…'}</div>}
          {hospital && (
            <div className="table-wrap">
              <table className="res">
                <thead>
                  <tr>
                    <th>Resource</th>
                    <th>Availability</th>
                    <th>Last confirmed</th>
                    <th>Last simulation update</th>
                    <th className="th-actions">Update</th>
                  </tr>
                </thead>
                <tbody>
                  {hospital.resources.map((res) => {
                    const age = minutesAgo(res.updated_at, now);
                    const stale = age > STALE_AFTER_MIN;
                    const lv = level(res);
                    const pct = res.total > 0 ? Math.round((res.available / res.total) * 100) : 0;
                    return (
                      <tr key={res.type} className={`res-row res-${lv}`}>
                        <td>
                          <div className="res-name">{RESOURCE_LABELS[res.type]}</div>
                          <span className={`level level-${lv}`}>{LEVEL_TEXT[lv]}</span>
                        </td>
                        <td>
                          <div className="avail">
                            <span className="avail-num">{res.available}</span>
                            <span className="avail-total">of {res.total} total</span>
                          </div>
                          <div className="meter" role="img" aria-label={`${res.available} of ${res.total} free`}>
                            <span style={{ width: `${pct}%` }} />
                          </div>
                        </td>
                        <td data-label="Last confirmed">
                          <span className="tag tag-staff">Staff confirmed</span>
                          <div className={`ts ${stale ? 'ts-stale' : ''}`}>{formatAge(age)}</div>
                          {stale && <div className="ts-flag">Stale — please confirm</div>}
                        </td>
                        <td data-label="Last simulation update">
                          {res.sim_changed_at ? (
                            <div title="Changed by the demo simulator, not confirmed by staff">
                              <span className="tag tag-sim">SIM {res.sim_delta && res.sim_delta > 0 ? '+' : ''}{res.sim_delta}</span>
                              <div className="ts ts-sim">{formatAge(minutesAgo(res.sim_changed_at, now))}</div>
                            </div>
                          ) : (
                            <span className="ts-none">No simulator changes</span>
                          )}
                        </td>
                        <td className="td-controls">
                          <div className="controls">
                            <div className="stepper">
                              <button className="step" aria-label={`Decrease ${RESOURCE_LABELS[res.type]}`} disabled={busy || res.available <= 0} onClick={() => setAvail(res, res.available - 1)}>−</button>
                              <button className="step" aria-label={`Increase ${RESOURCE_LABELS[res.type]}`} disabled={busy || res.available >= res.total} onClick={() => setAvail(res, res.available + 1)}>+</button>
                            </div>
                            <button className="btn btn-small btn-outline" disabled={busy} onClick={() => setAvail(res, res.available)} title="Confirm the count is still correct">✓ Confirm</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
