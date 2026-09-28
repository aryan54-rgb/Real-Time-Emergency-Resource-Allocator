import { BadRequest, body, handle, str } from '@/lib/api';
import { query } from '@/lib/db';
import { RESOURCE_TYPES, type EmergencyRequest } from '@/lib/types';

export function POST(req: Request) {
  return handle(async () => {
    const b = await body(req);
    const severity = str(b, 'severity');
    if (!['critical', 'serious', 'stable'].includes(severity)) throw new BadRequest('Invalid severity');
    const needs = b.needs;
    if (!Array.isArray(needs) || needs.length === 0 || !needs.every((n) => RESOURCE_TYPES.includes(n)))
      throw new BadRequest(`"needs" must be a non-empty list of: ${RESOURCE_TYPES.join(', ')}`);
    const lat = Number(b.lat), lng = Number(b.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
      throw new BadRequest('Invalid lat/lng');
    const { rows } = await query<EmergencyRequest>(
      `insert into emergency_requests (patient_label, severity, needs, lat, lng)
       values ($1, $2, $3, $4, $5) returning *`,
      [str(b, 'patient_label'), severity, [...new Set(needs)], lat, lng]);
    return rows[0];
  });
}
