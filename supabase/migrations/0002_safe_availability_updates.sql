-- Fix: hospital staff count updates could re-open a bed that a dispatcher had just reserved.
--
-- The old set_availability(hospital, type, available) wrote an ABSOLUTE value computed from the
-- staff member's screen. If a reservation landed between the screen refresh and the click,
-- the stale value overwrote the decrement and the same bed could be reserved twice.
--
-- Now every staff update is a compare-and-set: it only applies if the count is still the one the
-- staff member saw (p_expected). Otherwise it raises STALE_COUNT and the UI refreshes.

drop function if exists set_availability(text, text, int);

create or replace function set_availability(p_hospital_id text, p_type text, p_expected int, p_available int)
returns resources
language plpgsql
as $$
declare
  res resources;
begin
  update resources
     set available = greatest(0, least(p_available, total)), updated_at = now()
   where hospital_id = p_hospital_id and type = p_type and available = p_expected
  returning * into res;

  if res.hospital_id is null then
    if exists (select 1 from resources where hospital_id = p_hospital_id and type = p_type) then
      raise exception 'STALE_COUNT' using errcode = 'P0001';
    end if;
    raise exception 'RESOURCE_NOT_FOUND' using errcode = 'P0001';
  end if;
  return res;
end;
$$;

-- Supabase only: the browser's anon key must not be able to call the write functions through
-- the REST API. (RLS already makes such calls no-ops; this removes the entry point entirely.)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function reserve_resources(uuid, text) from public, anon, authenticated;
    revoke execute on function release_holds(uuid) from public, anon, authenticated;
    revoke execute on function respond_to_request(uuid, text, boolean, text) from public, anon, authenticated;
    revoke execute on function complete_handover(uuid, text) from public, anon, authenticated;
    revoke execute on function cancel_request(uuid) from public, anon, authenticated;
    revoke execute on function set_availability(text, text, int, int) from public, anon, authenticated;
    -- Realtime postgres_changes needs table-level SELECT as well as the RLS policy; don't rely on defaults.
    grant usage on schema public to anon, authenticated;
    grant select on hospitals, resources, emergency_requests, reservations to anon, authenticated;
  end if;
end;
$$;
