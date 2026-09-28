import { BadRequest, body, handle, str, type Ctx } from '@/lib/api';
import { query } from '@/lib/db';

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const b = await body(req);
    if (typeof b.accept !== 'boolean') throw new BadRequest('"accept" must be true or false');
    const note = typeof b.note === 'string' ? b.note.slice(0, 200) : '';
    const { rows } = await query('select * from respond_to_request($1, $2, $3, $4)', [id, str(b, 'hospitalId'), b.accept, note]);
    return rows[0];
  });
}
