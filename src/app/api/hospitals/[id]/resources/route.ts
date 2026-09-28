import { BadRequest, body, handle, str, type Ctx } from '@/lib/api';
import { query } from '@/lib/db';

// Hospital staff set the live available count for one resource type.
// `expected` is the count the staff member was looking at; the update is refused (409 STALE_COUNT)
// if it changed in the meantime, e.g. because a dispatcher just reserved a unit.
export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const b = await body(req);
    const available = Number(b.available);
    const expected = Number(b.expected);
    if (!Number.isInteger(available)) throw new BadRequest('"available" must be an integer');
    if (!Number.isInteger(expected)) throw new BadRequest('"expected" (the count you last saw) must be an integer');
    const { rows } = await query('select * from set_availability($1, $2, $3, $4)', [id, str(b, 'type'), expected, available]);
    return rows[0];
  });
}
