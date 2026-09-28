-- Demo availability simulator support (HLTH02: "maintain simulated live availability data").
--
-- The simulator goes through the SAME compare-and-set function as hospital staff, with
-- p_source = 'simulator'. Differences from a staff update:
--   * it does NOT touch updated_at (= "last confirmed by hospital staff", which drives freshness);
--     it records sim_changed_at / sim_delta instead, so the UI can label it as simulated;
--   * it can never advertise units that the system has already given out: the result is capped at
--     total - (held + occupied reservations) as well as at [0, total].

alter table resources add column if not exists sim_changed_at timestamptz;
alter table resources add column if not exists sim_delta int;

drop function if exists set_availability(text, text, int, int);

create or replace function set_availability(
  p_hospital_id text, p_type text, p_expected int, p_available int, p_source text default 'staff')
returns resources
language plpgsql
as $$
declare
  res resources;
  cur resources;
  in_use int;
  target int;
begin
  if p_source not in ('staff', 'simulator') then
    raise exception 'BAD_SOURCE' using errcode = 'P0001';
  end if;

  select * into cur from resources where hospital_id = p_hospital_id and type = p_type;
  if cur.hospital_id is null then
    raise exception 'RESOURCE_NOT_FOUND' using errcode = 'P0001';
  end if;

  target := greatest(0, least(p_available, cur.total));
  if p_source = 'simulator' then
    select count(*) into in_use from reservations
     where hospital_id = p_hospital_id and resource_type = p_type and status in ('held', 'occupied');
    target := greatest(0, least(target, cur.total - in_use));
    if target = p_expected then
      raise exception 'SIM_NO_CHANGE' using errcode = 'P0001';
    end if;
  end if;

  -- Compare-and-set: applies only if the count is still the one the caller saw. Any concurrent
  -- reservation/release changes `available`, so the caller gets STALE_COUNT instead of overwriting it.
  if p_source = 'staff' then
    update resources
       set available = target, updated_at = now()
     where hospital_id = p_hospital_id and type = p_type and available = p_expected
    returning * into res;
  else
    update resources
       set available = target, sim_delta = target - available, sim_changed_at = now()
     where hospital_id = p_hospital_id and type = p_type and available = p_expected
    returning * into res;
  end if;

  if res.hospital_id is null then
    raise exception 'STALE_COUNT' using errcode = 'P0001';
  end if;
  return res;
end;
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function set_availability(text, text, int, int, text) from public, anon, authenticated;
  end if;
end;
$$;
