import { handle, NotFound, type Ctx } from '@/lib/api';
import { loadState, query } from '@/lib/db';
import { rankHospitals } from '@/lib/ranking';
import type { EmergencyRequest } from '@/lib/types';

export const dynamic = 'force-dynamic';

export function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const [state, { rows }] = await Promise.all([
      loadState(),
      query<EmergencyRequest>('select * from emergency_requests where id = $1', [id]),
    ]);
    const request = rows[0];
    if (!request) throw new NotFound('Unknown request');
    return rankHospitals(state.hospitals, request, new Date(state.serverTime)).map(({ hospital, ...r }) => ({
      hospitalId: hospital.id, name: hospital.name, ...r,
    }));
  });
}
