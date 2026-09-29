'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { SimBadge } from '@/components/SimBadge';
import { SyncBadge } from '@/components/SyncBadge';
import { StatusPill } from '@/components/StatusPill';
import { formatAge, minutesAgo, post } from '@/lib/client';
import { rankHospitals, WEIGHTS } from '@/lib/ranking';
import { RESOURCE_LABELS, RESOURCE_TYPES, type ResourceType, type Severity } from '@/lib/types';
import { useLiveState } from '@/lib/useLiveState';

const MapView = dynamic(() => import('@/components/MapView'), { ssr: false, loading: () => <div className="map map-loading">Loading map…</div> });

type Flash = { kind: 'ok' | 'bad'; text: string } | null;

// --- Simulated AI call co-pilot (demo only: scripted transcript + scripted extraction) ---
type CallPhase = 'idle' | 'live' | 'analyzing' | 'ready';
type Line = { who: 'dispatcher' | 'caller'; text: string; at: number };

const CALL_SCRIPT: Line[] = [
  { who: 'dispatcher', text: 'Emergency services. What is your emergency?', at: 300 },
  { who: 'caller', text: 'Please help! My husband collapsed, clutching his chest!', at: 1000 },
  { who: 'dispatcher', text: 'Where are you right now?', at: 1800 },
  { who: 'caller', text: "We're outside Akurdi railway station, near the main gate.", at: 2400 },
  { who: 'caller', text: "He's sweating and barely breathing. He has a heart condition.", at: 3100 },
];
const CALL_END_MS = 3700;
const ANALYZE_MS = 700;

const AI_EXTRACTION = {
  label: 'Male · collapsed, chest pain (suspected cardiac)',
  severity: 'critical' as Severity,
  needs: ['icu_bed', 'cardiac_unit'] as ResourceType[],
  location: { lat: 18.6485, lng: 73.768 }, // Akurdi railway station
};

const CRITICAL_TERMS = ['clutching his chest', 'barely breathing', 'heart condition', 'collapsed', 'sweating', 'chest'];
const LOCATION_TERMS = ['Akurdi railway station'];
const KEYWORD_RE = new RegExp(`(${[...CRITICAL_TERMS, ...LOCATION_TERMS].join('|')})`, 'gi');

function highlight(text: string) {
  // split() with a capture group puts the matches at odd indices
  return text.split(KEYWORD_RE).map((part, i) => {
    if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
    const isLocation = LOCATION_TERMS.some((t) => t.toLowerCase() === part.toLowerCase());
    return <mark key={i} className={`kw ${isLocation ? 'kw-location' : 'kw-critical'}`}>{part}</mark>;
  });
}

export default function DispatcherPage() {
  const { state, error, mode, refresh, now } = useLiveState();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash>(null);
  const [busy, setBusy] = useState(false);

  // new case (filled in by the call co-pilot, then verified by the dispatcher)
  const [label, setLabel] = useState('');
  const [severity, setSeverity] = useState<Severity>('critical');
  const [needs, setNeeds] = useState<ResourceType[]>([]);
  const [draft, setDraft] = useState<{ lat: number; lng: number } | null>(null);

  // call co-pilot
  const [callPhase, setCallPhase] = useState<CallPhase>('idle');
  const [transcript, setTranscript] = useState<Line[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const transcriptEnd = useRef<HTMLDivElement>(null);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => clearTimers, []);
  useEffect(() => { transcriptEnd.current?.scrollIntoView({ block: 'nearest' }); }, [transcript]);

  function acceptCall() {
    clearTimers();
    setTranscript([]);
    setLabel(''); setNeeds([]); setDraft(null);
    setSelectedId(null);
    setCallPhase('live');
    const at = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    CALL_SCRIPT.forEach((line) => at(line.at, () => setTranscript((t) => [...t, line])));
    at(CALL_END_MS, () => setCallPhase('analyzing'));
    at(CALL_END_MS + ANALYZE_MS, () => {
      setLabel(AI_EXTRACTION.label);
      setSeverity(AI_EXTRACTION.severity);
      setNeeds(AI_EXTRACTION.needs);
      setDraft(AI_EXTRACTION.location);
      setCallPhase('ready');
    });
  }

  function endCall() {
    clearTimers();
    setCallPhase('idle');
    setTranscript([]);
    setLabel(''); setNeeds([]); setDraft(null);
  }

  const hospitals = state?.hospitals ?? [];
  const requests = state?.requests ?? [];
  const selected = requests.find((r) => r.id === selectedId) ?? null;
  const hospitalName = (id: string | null) => hospitals.find((h) => h.id === id)?.name ?? id ?? '';

  const ranking = useMemo(
    () => (selected ? rankHospitals(hospitals, selected, new Date(now)) : []),
    [selected, hospitals, now],
  );

  const show = (f: Flash) => { setFlash(f); setTimeout(() => setFlash((cur) => (cur === f ? null : cur)), 6000); };

  async function createCase() {
    if (!draft) return show({ kind: 'bad', text: 'Click the map to set the patient location first.' });
    if (needs.length === 0) return show({ kind: 'bad', text: 'Select at least one needed resource.' });
    setBusy(true);
    const r = await post<{ id: string }>('/api/requests', {
      patient_label: label.trim() || `Case ${new Date().toLocaleTimeString()}`, severity, needs, ...draft,
    });
    setBusy(false);
    if (!r.ok) return show({ kind: 'bad', text: r.message });
    setSelectedId(r.data.id);
    endCall();
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
        <div className="topbar-title">
          <span className="eyebrow">Emergency dispatch</span>
          <h1>Dispatcher console</h1>
        </div>
        <div className="topbar-status">
          {state && <SimBadge hospitals={hospitals} now={now} />}
          <SyncBadge mode={mode} error={error} />
        </div>
      </header>

      {flash && <div className={`flash flash-${flash.kind}`} role="status">{flash.text}</div>}

      <div className="dispatch-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>AI call co-pilot</h2>
            {callPhase === 'live' && <span className="live-dot">● Live</span>}
          </div>

          {callPhase === 'idle' && (
            <button className="btn btn-primary btn-block btn-call" onClick={acceptCall}>
              Accept 108 Call
            </button>
          )}

          {callPhase !== 'idle' && (
            <div className="copilot">
              <div className="transcript" aria-live="polite">
                <div className="transcript-head">Live transcript</div>
                {transcript.map((l, i) => (
                  <p key={i} className={`transcript-line transcript-${l.who}`}>
                    <span className="transcript-who">{l.who === 'caller' ? 'Caller' : 'Dispatcher'}:</span> {highlight(l.text)}
                  </p>
                ))}
                {callPhase === 'live' && <p className="transcript-typing">…</p>}
                {callPhase === 'analyzing' && <p className="transcript-analyzing">Call ended · AI extracting case details…</p>}
                <div ref={transcriptEnd} />
              </div>

              {callPhase === 'ready' && (
                <div className="ai-extract">
                  <div className="ai-extract-head">
                    <span className="tag tag-ai">AI suggested</span>
                    <span className="subtle">Review and correct before creating the case</span>
                  </div>
                  <div className="ai-field">
                    <span className="ai-field-label">Summary</span>
                    <strong>{label}</strong>
                  </div>
                  <div className="ai-field">
                    <span className="ai-field-label">Severity</span>
                    <div className="segmented">
                      {(['critical', 'serious', 'stable'] as Severity[]).map((s) => (
                        <button key={s} type="button" className={`seg sev-${s} ${severity === s ? 'seg-on' : ''}`} onClick={() => setSeverity(s)}>{s}</button>
                      ))}
                    </div>
                  </div>
                  <div className="ai-field">
                    <span className="ai-field-label">Needed resources <span className="subtle">(all are reserved together)</span></span>
                    <div className="chips">
                      {RESOURCE_TYPES.map((t) => (
                        <label key={t} className={`chip ${needs.includes(t) ? 'chip-on' : ''}`}>
                          <input type="checkbox" checked={needs.includes(t)} onChange={() => toggleNeed(t)} />
                          {RESOURCE_LABELS[t]}
                        </label>
                      ))}
                    </div>
                  </div>
                  <p className={`pin-hint ${draft ? 'pin-set' : ''}`}>
                    <span aria-hidden>{draft ? '●' : '○'}</span>
                    {draft ? `Pin dropped: ${draft.lat.toFixed(4)}, ${draft.lng.toFixed(4)} — click the map to adjust` : 'Click the map to set the patient location.'}
                  </p>
                  <button className="btn btn-primary btn-block" disabled={busy || !draft || needs.length === 0} onClick={createCase}>
                    {busy ? 'Ranking hospitals…' : 'Verify AI & Find Hospitals'}
                  </button>
                </div>
              )}

              <button className="btn btn-ghost btn-block" onClick={endCall}>
                {callPhase === 'ready' ? 'Discard call' : 'End call'}
              </button>
            </div>
          )}

          <div className="panel-head panel-head-sub">
            <h2>Open cases</h2>
            <span className={`count ${open.length ? 'count-alert' : ''}`}>{open.length}</span>
          </div>
          <ul className="case-list">
            {open.length === 0 && (
              <li className="empty empty-compact">
                <span className="empty-icon" aria-hidden>+</span>
                <div><strong>No open cases</strong><p>Accept an incoming call to create a case and rank hospitals.</p></div>
              </li>
            )}
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
              onPick={callPhase === 'ready' ? (lat, lng) => setDraft({ lat, lng }) : undefined} onSelectRequest={setSelectedId} />
          ) : <div className="map map-loading">{error ? `Cannot load data: ${error}` : 'Loading…'}</div>}
          <div className="legend">
            <span><i style={{ background: '#2e7d5b' }} /> ICU ≥ 2 free</span>
            <span><i style={{ background: '#c77c0e' }} /> 1 free</span>
            <span><i style={{ background: '#a31111' }} /> none</span>
            <span><i style={{ background: '#1f262a' }} /> case</span>
          </div>
        </section>

        <section className="panel">
          {!selected && (
            <div className="empty">
              <span className="empty-icon" aria-hidden>≡</span>
              <div>
                <strong>No case selected</strong>
                <p>Select an open case or take a call to see hospitals ranked by resource match, estimated travel time and data freshness.</p>
              </div>
            </div>
          )}
          {selected && (
            <>
              <div className="case-banner">
                <div className="case-head">
                  <h2>{selected.patient_label}</h2>
                  <StatusPill status={selected.status} />
                </div>
                <div className="need-chips">
                  <span className={`sev-chip sev-${selected.severity}`}>{selected.severity}</span>
                  {selected.needs.map((n) => <span key={n} className="need-chip">{RESOURCE_LABELS[n]}</span>)}
                  <span className="subtle">created {formatAge(minutesAgo(selected.created_at, now))}</span>
                </div>
              </div>

              {selected.status === 'pending' && (
                <>
                  {selected.rejected_by.length > 0 && (
                    <p className="callout callout-warn">Rejected by {selected.rejected_by.join(', ')} — choose another hospital.</p>
                  )}
                  <div className="panel-head panel-head-sub"><h3>Ranked hospitals</h3></div>
                  <ol className="rank-list">
                    {ranking.map((r, i) => (
                      <li key={r.hospital.id} className={`rank-card ${r.reservable ? '' : 'rank-off'} ${i === 0 && r.reservable ? 'rank-best' : ''}`}>
                        <div className="rank-num">{i + 1}</div>
                        <div className="rank-main">
                          <div className="rank-top">
                            <div className="rank-title">
                              <strong>{r.hospital.name}</strong>
                              {i === 0 && r.reservable && <span className="tag tag-best">Top match</span>}
                            </div>
                            <div className="rank-side">
                              <div className="score" title="Weighted score (0–1)">
                                <span className="score-value">{r.score.toFixed(2)}</span>
                                <div className="scorebar"><span style={{ width: `${r.score * 100}%` }} /></div>
                              </div>
                              <button className="btn btn-small btn-primary" disabled={!r.reservable || busy} onClick={() => reserve(r.hospital.id)}>Reserve</button>
                            </div>
                          </div>
                          <div className="metrics">
                            <div className={`metric ${r.missing.length ? 'metric-bad' : 'metric-ok'}`}>
                              <span className="metric-label" title="Share of needed resources available">Match</span>
                              <span className="metric-value">{Math.round(r.match * 100)}%</span>
                            </div>
                            <div className="metric">
                              <span className="metric-label" title="Estimated from straight-line distance">Travel (est.)</span>
                              <span className="metric-value">{Math.round(r.etaMin)} min</span>
                              <span className="metric-sub">{r.distanceKm.toFixed(1)} km</span>
                            </div>
                            <div className={`metric ${r.stale ? 'metric-warn' : ''}`}>
                              <span className="metric-label" title="Time since hospital staff last confirmed these counts">Confirmed</span>
                              <span className="metric-value">{formatAge(r.dataAgeMin)}</span>
                              {r.stale && <span className="metric-sub">stale</span>}
                            </div>
                          </div>
                          {r.missing.length > 0 && <div className="rank-flag rank-flag-bad">Missing: {r.missing.map((m) => RESOURCE_LABELS[m]).join(', ')}</div>}
                          {r.rejected && <div className="rank-flag rank-flag-bad">Rejected this case</div>}
                        </div>
                      </li>
                    ))}
                  </ol>
                  <p className="footnote">
                    Score = {WEIGHTS.match}·match + {WEIGHTS.travel}·travel + {WEIGHTS.freshness}·freshness.
                    Travel time is estimated from distance (no live traffic in this MVP).
                  </p>
                </>
              )}

              {selected.status === 'reserved' && (
                <p className="callout callout-info">Held at <strong>{hospitalName(selected.hospital_id)}</strong>. Waiting for hospital staff to accept or reject.</p>
              )}
              {selected.status === 'accepted' && (
                <p className="callout callout-ok">Accepted by <strong>{hospitalName(selected.hospital_id)}</strong> — dispatch the ambulance. The crew confirms handover on arrival.</p>
              )}
              {selected.status === 'handed_over' && <p className="callout callout-ok">Patient handed over at <strong>{hospitalName(selected.hospital_id)}</strong>.</p>}
              {selected.status === 'cancelled' && <p className="callout">This case was cancelled.</p>}

              {['reserved', 'accepted'].includes(selected.status) && (
                <Link href={`/ambulance/${selected.id}`} target="_blank" className="btn btn-block btn-crew">Open ambulance crew view ↗</Link>
              )}
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
