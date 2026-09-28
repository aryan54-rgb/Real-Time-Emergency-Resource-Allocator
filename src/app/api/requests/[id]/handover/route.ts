import { body, handle, str, type Ctx } from '@/lib/api';
import { query } from '@/lib/db';

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const { rows } = await query('select * from complete_handover($1, $2)', [id, str(await body(req), 'hospitalId')]);
    return rows[0];
  });
}
