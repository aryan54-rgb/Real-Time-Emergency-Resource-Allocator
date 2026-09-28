import { handle, type Ctx } from '@/lib/api';
import { query } from '@/lib/db';

export function POST(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const { rows } = await query('select * from cancel_request($1)', [id]);
    return rows[0];
  });
}
