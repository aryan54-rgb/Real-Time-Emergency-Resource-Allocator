import { body, handle, str, type Ctx } from '@/lib/api';
import { query } from '@/lib/db';

// The atomic step: exactly one concurrent caller can claim the last unit (see reserve_resources()).
export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const { rows } = await query('select * from reserve_resources($1, $2)', [id, str(await body(req), 'hospitalId')]);
    return rows[0];
  });
}
