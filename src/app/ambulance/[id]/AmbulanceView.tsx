'use client';
import Link from 'next/link';
import { useState } from 'react';
import { SyncBadge } from '@/components/SyncBadge';
import { formatAge, minutesAgo, post } from '@/lib/client';
import { estimateEtaMin, haversineKm } from '@/lib/ranking';
import { RESOURCE_LABELS } from '@/lib/types';
import { useLiveState } from '@/lib/useLiveState';

const STATUS_TEXT = {
  pending: 'Awaiting destination',
  reserved: 'Awaiting hospital',
  accepted: 'En route',
  handed_over: 'Handed over',
  cancelled: 'Cancelled',
} as const;

export function AmbulanceView({ caseId }: { caseId: string }) {
  const { state, error, mode, refresh, now } = useLiveState();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const req = state?.requests.find((r) => r.id === caseId);
  const hospital = req?.hospital_id ? state?.hospitals.find((h) => h.id === req.hospital_id) : undefined;

  // ETA is an estimate from straight-line distance (same model as the ranking), counted down from acceptance.
  const distanceKm = req && hospital ? haversineKm(req.lat, req.lng, hospital.lat, hospital.lng) : null;
  const totalEta = distanceKm === null ? null : estimateEtaMin(distanceKm);
  const remaining = totalEta === null || !req ? null
    : req.status === 'accepted' ? Math.max(0, totalEta - minutesAgo(req.updated_at, now)) : totalEta;

  async function handover() {
    if (!req?.hospital_id) return;
    setBusy(true); setFailure(null);
    const r = await post(`/api/requests/${req.id}/handover`, { hospitalId: req.hospital_id });
    setBusy(false);
    if (!r.ok) setFailure(r.message);
    await refresh();
  }

  return (
    <main className="phone-stage">
      <div className="phone">
        <div className="phone-top">
          <span className="eyebrow">Ambulance · crew view</span>
          <SyncBadge mode={mode} error={error} />
        </div>

        {!state && <div className="phone-empty">{error ? `Cannot load data: ${error}` : 'Loading case…'}</div>}

        {state && !req && (
          <div className="phone-empty">
            <strong>Case not found</strong>
            <p>This link does not match any case. <Link href="/">Back to start</Link></p>
          </div>
        )}

        {req && (
          <>
            <div className={`amb-status amb-status-${req.status}`}>
              <span className="amb-status-dot" aria-hidden />
              {STATUS_TEXT[req.status]}
            </div>

            <section className="amb-dest">
              <span className="amb-label">Target destination</span>
              {hospital ? (
                <>
                  <h1>{hospital.name}</h1>
                  <p>{hospital.address}</p>
                  <a className="amb-nav" target="_blank" rel="noreferrer"
                    href={`https://www.google.com/maps/dir/?api=1&origin=${req.lat},${req.lng}&destination=${hospital.lat},${hospital.lng}&travelmode=driving`}>
                    Open navigation ↗
                  </a>
                </>
              ) : (
                <>
                  <h1>Not assigned yet</h1>
                  <p>The dispatcher is choosing a hospital. This screen updates automatically.</p>
                </>
              )}
            </section>

            {remaining !== null && req.status !== 'handed_over' && req.status !== 'cancelled' && (
              <section className="amb-eta">
                <div>
                  <span className="amb-label">ETA (est.)</span>
                  <div className="amb-eta-value">
                    {remaining < 1 ? 'Arriving' : <>{Math.ceil(remaining)}<small> min</small></>}
                  </div>
                </div>
                <div className="amb-eta-side">
                  <span className="amb-label">Distance</span>
                  <strong>{distanceKm!.toFixed(1)} km</strong>
                </div>
              </section>
            )}

            <section className="amb-card">
              <div className="amb-card-head">
                <span className="amb-label">Patient</span>
                <span className={`sev-chip sev-${req.severity}`}>{req.severity}</span>
              </div>
              <strong className="amb-patient">{req.patient_label}</strong>
              <div className="need-chips">
                {req.needs.map((n) => <span key={n} className="need-chip">{RESOURCE_LABELS[n]}</span>)}
              </div>
              <span className="subtle">Case opened {formatAge(minutesAgo(req.created_at, now))}</span>
              {req.note && <span className="case-note">Hospital note: {req.note}</span>}
            </section>

            {failure && <div className="flash flash-bad" role="alert">{failure}</div>}

            <div className="amb-action">
              {req.status === 'accepted' && (
                <button className="btn btn-handover" disabled={busy} onClick={handover}>
                  {busy ? 'Confirming…' : 'Confirm Patient Handover'}
                </button>
              )}
              {(req.status === 'pending' || req.status === 'reserved') && (
                <button className="btn btn-handover" disabled>Waiting for hospital to accept</button>
              )}
              {req.status === 'handed_over' && (
                <div className="amb-done">
                  <span aria-hidden>✓</span>
                  <strong>Handover complete</strong>
                  <p>Patient handed over at {hospital?.name ?? 'the hospital'}. The case is closed.</p>
                </div>
              )}
              {req.status === 'cancelled' && (
                <div className="amb-done amb-done-cancelled">
                  <strong>Case cancelled by dispatch</strong>
                  <p>Stand by for a new assignment.</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
