import 'server-only';
import { NextResponse } from 'next/server';

// Business-rule violations raised by the SQL functions (errcode P0001), mapped to HTTP 409.
const CONFLICTS: Record<string, string> = {
  RESOURCE_UNAVAILABLE: 'That resource was just taken by another request. Pick the next-ranked hospital.',
  REQUEST_NOT_PENDING: 'This request is no longer waiting for a hospital.',
  HOSPITAL_ALREADY_REJECTED: 'This hospital already rejected the request.',
  REQUEST_NOT_AWAITING_THIS_HOSPITAL: 'This request is not awaiting a response from this hospital.',
  REQUEST_NOT_ACCEPTED_BY_THIS_HOSPITAL: 'Only an accepted request can be handed over, by the accepting hospital.',
  REQUEST_NOT_CANCELLABLE: 'This request can no longer be cancelled.',
  RESOURCE_NOT_FOUND: 'Unknown hospital or resource type.',
  STALE_COUNT: 'That count changed a moment ago (e.g. a dispatcher reserved a unit). The screen has been refreshed; please check and try again.',
};

export class BadRequest extends Error {}
export class NotFound extends Error {}

export async function handle(fn: () => Promise<unknown>) {
  try {
    return NextResponse.json(await fn());
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (e instanceof NotFound) return NextResponse.json({ error: 'NOT_FOUND', message: err.message }, { status: 404 });
    if (e instanceof BadRequest) return NextResponse.json({ error: 'BAD_REQUEST', message: err.message }, { status: 400 });
    if (err.code === 'P0001' && err.message) {
      const [code, detail] = err.message.split(':');
      return NextResponse.json({ error: code, detail, message: CONFLICTS[code] ?? err.message }, { status: 409 });
    }
    if (err.code === '22P02') return NextResponse.json({ error: 'BAD_REQUEST', message: 'Malformed id' }, { status: 400 });
    if (err.code === '22003') return NextResponse.json({ error: 'BAD_REQUEST', message: 'Number out of range' }, { status: 400 });
    if (err.code === '23503') return NextResponse.json({ error: 'NOT_FOUND', message: 'Unknown hospital' }, { status: 404 });
    if (err.code === '40P01' || err.code === '40001')
      return NextResponse.json({ error: 'RETRY', message: 'The database was busy with a conflicting update. Please try again.' }, { status: 409 });
    console.error(e);
    return NextResponse.json({ error: 'INTERNAL', message: 'Unexpected server error' }, { status: 500 });
  }
}

export async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    if (b && typeof b === 'object') return b as Record<string, unknown>;
  } catch {}
  throw new BadRequest('Expected a JSON object body');
}

export function str(b: Record<string, unknown>, key: string): string {
  const v = b[key];
  if (typeof v !== 'string' || !v.trim()) throw new BadRequest(`"${key}" is required`);
  return v.trim();
}

export type Ctx = { params: Promise<{ id: string }> };
