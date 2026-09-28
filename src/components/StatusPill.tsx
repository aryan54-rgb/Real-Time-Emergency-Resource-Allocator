import type { RequestStatus } from '@/lib/types';

const TEXT: Record<RequestStatus, string> = {
  pending: 'Needs hospital',
  reserved: 'Awaiting hospital',
  accepted: 'Accepted · en route',
  handed_over: 'Handed over',
  cancelled: 'Cancelled',
};

export function StatusPill({ status }: { status: RequestStatus }) {
  return <span className={`pill pill-${status}`}>{TEXT[status]}</span>;
}
