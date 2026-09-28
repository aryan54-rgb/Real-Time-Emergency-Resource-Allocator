'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { SimBadge } from '@/components/SimBadge';
import { SyncBadge } from '@/components/SyncBadge';
import { StatusPill } from '@/components/StatusPill';
import { formatAge, minutesAgo, post } from '@/lib/client';
import { rankHospitals, WEIGHTS } from '@/lib/ranking';
import { RESOURCE_LABELS, RESOURCE_TYPES, type ResourceType, type Severity } from '@/lib/types';
import { useLiveState } from '@/lib/useLiveState';

const MapView = dynamic(() => import('@/components/MapView'), { ssr: false, loading: () => <div className="map map-loading">Loading map…</div> });

type Flash = { kind: 'ok' | 'bad'; text: string } | null;

export default function DispatcherPage() {
  const { state, error, mode, refresh, now } = useLiveState();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash>(null);
  const [busy, setBusy] = useState(false);

  // new-case form
  const [label, setLabel] = useState('');
  const [severity, setSeverity] = useState<Severity>('critical');
  const [needs, setNeeds] = useState<ResourceType[]>(['icu_bed']);
  const [draft, setDraft] = useState<{ lat: number; lng: number } | null>(null);

  const hospitals = state?.hospitals ?? [];
  const requests = state?.requests ?? [];
  const selected = requests.find((r) => r.id === selectedId) ?? null;
  const hospitalName = (id: string | null) => hospitals.find((h) => h.id === id)?.name ?? id ?? '';

  const ranking = useMemo(
    () => (selected ? rankHospitals(hospitals, selected, new Date(now)) : []),
    [selected, hospitals, now],
  );

  const show = (f: Flash) => { setFlash(f); setTimeout(() => setFlash((cur) => (cur === f ? null : cur)), 6000); };

  async function createCase(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return show({ kind: 'bad', text: 'Click the map to set the patient location first.' });
    if (needs.length === 0) return show({ kind: 'bad', text: 'Select at least one needed resource.' });
    setBusy(true);
    const r = await post<{ id: string }>('/api/requests', {
      patient_label: label.trim() || `Case ${new Date().toLocaleTimeString()}`, severity, needs, ...draft,
    });
    setBusy(false);
    if (!r.ok) return show({ kind: 'bad', text: r.message });
    setSelectedId(r.data.id);
    setLabel(''); setDraft(null);
    await refresh();
  }

  async function reserve(hospitalId: string) {
    if (!selected) return;
    setBusy(true);
    const r = await post(`/api/requests/${selected.id}/reserve`, { hospitalId });
    setBusy(false);
    await refresh();
    if (r.ok) show({ kind: 'ok', text: `Reserved at ${hospitalName(hospitalId)} — waiting for the hospital to confirm.` });
    else show({ kind: 'bad', text: r.error === 'RESOURCE_UNAVAILABLE' ? `Not reserved: ${r.message} The list has been re-ranked.` : r.message });
  }

  async function cancel(id: string) {
    const r = await post(`/api/requests/${id}/cancel`);
    await refresh();
    show(r.ok ? { kind: 'ok', text: 'Request cancelled; any held resources were released.' } : { kind: 'bad', text: r.message });
  }

  const toggleNeed = (t: ResourceType) => setNeeds((n) => (n.includes(t) ? n.filter((x) => x !== t) : [...n, t]));
  const open = requests.filter((r) => r.status !== 'cancelled' && r.status !== 'handed_over');
  const closed = requests.filter((r) => r.status === 'cancelled' || r.status === 'handed_over').slice(0, 5);

  return (
    <main className="page">
      <header className="topbar">
        <Link href="/" className="brand"><span>Pulse</span>Route</Link>
        <h1>Dispatcher console</h1>
        {state && <SimBadge hospitals={hospitals} now={now} />}
        <SyncBadge mode={mode} error={error} />
      </header>

      {flash && <div className={`flash flash-${flash.kind}`} role="status">{flash.text}</div>}

      <div className="dispatch-grid">
        <section className="panel">
          <h2>New emergency case</h2>
          <form onSubmit={createCase} className="form">
            <label>Patient / case label
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. RTA male ~40y" maxLength={60} />
            </label>
            <label>Severity
              <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
                <option value="critical">Critical</option>
                <option value="serious">Serious</option>
                <option value="stable">Stable</option>
              </select>
            </label>
            <fieldset>
              <legend>Needed resources (all are reserved together)</legend>
              <div className="chips">
                {RESOURCE_TYPES.map((t) => (
                  <label key={t} className={`chip ${needs.includes(t) ? 'chip-on' : ''}`}>
                    <input type="checkbox" checked={needs.includes(t)} onChange={() => toggleNeed(t)} />
                    {RESOURCE_LABELS[t]}
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="hint">{draft ? `Location: ${draft.lat.toFixed(4)}, ${draft.lng.toFixed(4)}` : 'Click the map to set the patient location.'}</p>
            <button className="btn btn-primary" disabled={busy || !draft}>Create case</button>
          </form>

          <h2>Open cases ({open.length})</h2>
          <ul className="case-list">
            {open.length === 0 && <li className="muted">No open cases.</li>}
            {open.map((r) => (
              <li key={r.id} className={r.id === selectedId ? 'case case-selected' : 'case'} onClick={() => setSelectedId(r.id)}>
                <div className="case-head">
                  <strong>{r.patient_label}</strong>
                  <StatusPill status={r.status} />
                </div>
                <div className="case-meta">
                  <span className={`sev sev-${r.severity}`}>{r.severity}</span>
                  {r.needs.map((n) => RESOURCE_LABELS[n]).join(' + ')}
                  {r.hospital_id && <> · {hospitalName(r.hospital_id)}</>}
                </div>
                {r.note && <div className="case-note">Note: {r.note}</div>}
              </li>
            ))}
          </ul>
          {closed.length > 0 && (
            <>
              <h3>Recently closed</h3>
              <ul className="case-list">
                {closed.map((r) => (
                  <li key={r.id} className="case case-closed" onClick={() => setSelectedId(r.id)}>
                    <div className="case-head"><span>{r.patient_label}</span><StatusPill status={r.status} /></div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="panel panel-map">
          {state ? (
            <MapView hospitals={hospitals} requests={requests} selectedRequestId={selectedId} draft={draft}
              onPick={(lat, lng) => setDraft({ lat, lng })} onSelectRequest={setSelectedId} />
          ) : <div className="map map-loading">{error ? `Cannot load data: ${error}` : 'Loading…'}</div>}
          <div className="legend">
            <span><i style={{ background: '#2e7d5b' }} /> ICU ≥ 2 free</span>
            <span><i style={{ background: '#c77c0e' }} /> 1 free</span>
            <span><i style={{ background: '#a31111' }} /> none</span>
            <span><i style={{ background: '#1f262a' }} /> case</span>
          </div>
        </section>

        <section className="panel">
          {!selected && <p className="muted">Select or create a case to see ranked hospitals.</p>}
          {selected && (
            <>
              <div className="case-head">
                <h2>{selected.patient_label}</h2>
                <StatusPill status={selected.status} />
              </div>
              <p className="muted small">
                Needs {selected.needs.map((n) => RESOURCE_LABELS[n]).join(' + ')} · created {formatAge(minutesAgo(selected.created_at, now))}
              </p>

              {selected.status === 'pending' && (
                <>
                  {selected.rejected_by.length > 0 && (
                    <p className="warn small">Rejected by {selected.rejected_by.join(', ')} — choose another hospital.</p>
                  )}
                  <table className="rank">
                    <thead>
                      <tr><th>#</th><th>Hospital</th><th title="Share of needed resources available">Match</th><th title="Estimated from straight-line distance">ETA*</th><th title="Time since hospital staff last confirmed these counts">Data</th><th>Score</th><th /></tr>
                    </thead>
                    <tbody>
                      {ranking.map((r, i) => (
                        <tr key={r.hospital.id} className={r.reservable ? '' : 'row-off'}>
                          <td>{i + 1}</td>
                          <td>
                            <div className="strong">{r.hospital.name}</div>
                            {r.missing.length > 0 && <div className="bad small">Missing: {r.missing.map((m) => RESOURCE_LABELS[m]).join(', ')}</div>}
                            {r.rejected && <div className="bad small">Rejected this case</div>}
                          </td>
                          <td>{Math.round(r.match * 100)}%</td>
                          <td>{Math.round(r.etaMin)} min<div className="muted small">{r.distanceKm.toFixed(1)} km</div></td>
                          <td className={r.stale ? 'warn' : ''}>{formatAge(r.dataAgeMin)}{r.stale && <div className="small">stale</div>}</td>
                          <td><div className="scorebar"><span style={{ width: `${r.score * 100}%` }} /></div>{r.score.toFixed(2)}</td>
                          <td><button className="btn btn-small" disabled={!r.reservable || busy} onClick={() => reserve(r.hospital.id)}>Reserve</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="muted small">
                    Score = {WEIGHTS.match}·match + {WEIGHTS.travel}·travel + {WEIGHTS.freshness}·freshness.
                    *ETA is estimated from distance (no live traffic in this MVP).
                  </p>
                </>
              )}

              {selected.status === 'reserved' && (
                <p>Held at <strong>{hospitalName(selected.hospital_id)}</strong>. Waiting for hospital staff to accept or reject.</p>
              )}
              {selected.status === 'accepted' && (
                <p className="ok">Accepted by <strong>{hospitalName(selected.hospital_id)}</strong> — dispatch the ambulance. The hospital confirms handover on arrival.</p>
              )}
              {selected.status === 'handed_over' && <p className="ok">Patient handed over at <strong>{hospitalName(selected.hospital_id)}</strong>.</p>}
              {selected.status === 'cancelled' && <p className="muted">This case was cancelled.</p>}

              {['pending', 'reserved', 'accepted'].includes(selected.status) && (
                <button className="btn btn-ghost" onClick={() => cancel(selected.id)}>Cancel case</button>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
