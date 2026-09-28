import Link from 'next/link';
import { loadState } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function Home() {
  let hospitals: { id: string; name: string; address: string }[] = [];
  let error: string | null = null;
  try {
    hospitals = (await loadState()).hospitals;
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <main className="page home">
      <h1 className="brand brand-big"><span>Pulse</span>Route</h1>
      <p className="muted">Real-time emergency resource allocator · HackMatrix HLTH02 MVP</p>
      {error && <p className="flash flash-bad">Database not reachable: {error}. See README → Setup.</p>}
      <div className="home-grid">
        <Link href="/dispatcher" className="tile tile-primary">
          <strong>Dispatcher console</strong>
          <span>Create cases, see ranked hospitals, reserve resources.</span>
        </Link>
        {hospitals.map((h) => (
          <Link key={h.id} href={`/hospital/${h.id}`} className="tile">
            <strong>{h.name}</strong>
            <span>{h.id} · {h.address} — hospital staff view</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
