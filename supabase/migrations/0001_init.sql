-- PulseRoute (HLTH02) schema: hospitals, live resources, emergency requests, reservations.
-- Runs unchanged on Supabase (SQL editor / `supabase db push`) and on plain PostgreSQL.

create extension if not exists pgcrypto;

create table if not exists hospitals (
  id          text primary key,
  name        text not null,
  address     text not null default '',
  lat         double precision not null,
  lng         double precision not null,
  created_at  timestamptz not null default now()
);

-- One row per (hospital, resource type). `available` can never go below 0 or above `total`,
-- so even a buggy caller cannot over-allocate.
create table if not exists resources (
  hospital_id text not null references hospitals(id) on delete cascade,
  type        text not null check (type in ('icu_bed', 'general_bed', 'ventilator', 'trauma_team', 'cardiac_unit')),
  total       int  not null check (total >= 0),
  available   int  not null check (available >= 0),
  updated_at  timestamptz not null default now(),
  primary key (hospital_id, type),
  check (available <= total)
);

-- pending   -> waiting for the dispatcher to pick a hospital
-- reserved  -> resources held at one hospital, waiting for that hospital to accept/reject
-- accepted  -> hospital confirmed, ambulance en route
-- handed_over -> patient received; held resources are now occupied
-- cancelled -> dispatcher cancelled; any hold released
create table if not exists emergency_requests (
  id              uuid primary key default gen_random_uuid(),
  patient_label   text not null,
  severity        text not null check (severity in ('critical', 'serious', 'stable')),
  needs           text[] not null check (cardinality(needs) > 0),
  lat             double precision not null,
  lng             double precision not null,
  status          text not null default 'pending'
                  check (status in ('pending', 'reserved', 'accepted', 'handed_over', 'cancelled')),
  hospital_id     text references hospitals(id),
  rejected_by     text[] not null default '{}',
  note            text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists reservations (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references emergency_requests(id) on delete cascade,
  hospital_id   text not null references hospitals(id),
  resource_type text not null,
  status        text not null default 'held' check (status in ('held', 'released', 'occupied')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists reservations_request_idx on reservations(request_id);
create index if not exists requests_hospital_idx on emergency_requests(hospital_id, status);

-- ---------------------------------------------------------------------------
-- reserve_resources: atomically claim one unit of every needed resource at a hospital.
--
-- Concurrency safety: each `update ... where available > 0` takes a row lock; a competing
-- transaction blocks on that row, then re-evaluates `available > 0` against the committed
-- value (READ COMMITTED re-check). So for the last unit exactly one caller gets a row back
-- and the other gets zero rows -> we raise, and the whole transaction rolls back
-- (no partial holds). The request row is also claimed with a status guard, so one
-- request can never hold resources at two hospitals.
-- ---------------------------------------------------------------------------
create or replace function reserve_resources(p_request_id uuid, p_hospital_id text)
returns emergency_requests
language plpgsql
as $$
declare
  req emergency_requests;
  need text;
  claimed int;
begin
  update emergency_requests
     set status = 'reserved', hospital_id = p_hospital_id, updated_at = now()
   where id = p_request_id and status = 'pending'
  returning * into req;

  if req.id is null then
    raise exception 'REQUEST_NOT_PENDING' using errcode = 'P0001';
  end if;
  if p_hospital_id = any(req.rejected_by) then
    raise exception 'HOSPITAL_ALREADY_REJECTED' using errcode = 'P0001';
  end if;

  -- Lock resource rows in a fixed (sorted) order so two multi-resource requests
  -- can never deadlock each other.
  foreach need in array (select array_agg(distinct n order by n) from unnest(req.needs) n) loop
    -- updated_at is NOT touched: it means "last confirmed by hospital staff" (drives freshness)
    update resources
       set available = available - 1
     where hospital_id = p_hospital_id and type = need and available > 0;
    get diagnostics claimed = row_count;
    if claimed = 0 then
      raise exception 'RESOURCE_UNAVAILABLE:%', need using errcode = 'P0001';
    end if;
    insert into reservations (request_id, hospital_id, resource_type)
    values (p_request_id, p_hospital_id, need);
  end loop;

  return req;
end;
$$;

-- Give back every held unit of a request (used by reject and cancel).
create or replace function release_holds(p_request_id uuid)
returns void
language plpgsql
as $$
declare
  r reservations;
begin
  for r in
    update reservations set status = 'released', updated_at = now()
     where request_id = p_request_id and status = 'held'
    returning *
  loop
    update resources
       set available = least(available + 1, total)
     where hospital_id = r.hospital_id and type = r.resource_type;
  end loop;
end;
$$;

-- Hospital staff answer a reservation addressed to them.
create or replace function respond_to_request(p_request_id uuid, p_hospital_id text, p_accept boolean, p_note text default '')
returns emergency_requests
language plpgsql
as $$
declare
  req emergency_requests;
begin
  if p_accept then
    update emergency_requests
       set status = 'accepted', note = coalesce(p_note, ''), updated_at = now()
     where id = p_request_id and hospital_id = p_hospital_id and status = 'reserved'
    returning * into req;
  else
    update emergency_requests
       set status = 'pending', hospital_id = null, note = coalesce(p_note, ''),
           rejected_by = array_append(rejected_by, p_hospital_id), updated_at = now()
     where id = p_request_id and hospital_id = p_hospital_id and status = 'reserved'
    returning * into req;
    if req.id is not null then
      perform release_holds(p_request_id);
    end if;
  end if;

  if req.id is null then
    raise exception 'REQUEST_NOT_AWAITING_THIS_HOSPITAL' using errcode = 'P0001';
  end if;
  return req;
end;
$$;

-- Patient physically received: the held units become occupied (they stay subtracted).
create or replace function complete_handover(p_request_id uuid, p_hospital_id text)
returns emergency_requests
language plpgsql
as $$
declare
  req emergency_requests;
begin
  update emergency_requests
     set status = 'handed_over', updated_at = now()
   where id = p_request_id and hospital_id = p_hospital_id and status = 'accepted'
  returning * into req;
  if req.id is null then
    raise exception 'REQUEST_NOT_ACCEPTED_BY_THIS_HOSPITAL' using errcode = 'P0001';
  end if;
  update reservations set status = 'occupied', updated_at = now()
   where request_id = p_request_id and status = 'held';
  return req;
end;
$$;

create or replace function cancel_request(p_request_id uuid)
returns emergency_requests
language plpgsql
as $$
declare
  req emergency_requests;
begin
  update emergency_requests
     set status = 'cancelled', updated_at = now()
   where id = p_request_id and status in ('pending', 'reserved', 'accepted')
  returning * into req;
  if req.id is null then
    raise exception 'REQUEST_NOT_CANCELLABLE' using errcode = 'P0001';
  end if;
  perform release_holds(p_request_id);
  return req;
end;
$$;

-- Hospital staff set the live count for a resource (clamped to [0, total]).
create or replace function set_availability(p_hospital_id text, p_type text, p_available int)
returns resources
language plpgsql
as $$
declare
  res resources;
begin
  update resources
     set available = greatest(0, least(p_available, total)), updated_at = now()
   where hospital_id = p_hospital_id and type = p_type
  returning * into res;
  if res.hospital_id is null then
    raise exception 'RESOURCE_NOT_FOUND' using errcode = 'P0001';
  end if;
  return res;
end;
$$;

-- ---------------------------------------------------------------------------
-- Supabase only: row-level security (demo = public read-only; all writes go through the
-- Next.js server using the database connection) and Realtime publication.
-- Skipped automatically on plain PostgreSQL.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    alter table hospitals enable row level security;
    alter table resources enable row level security;
    alter table emergency_requests enable row level security;
    alter table reservations enable row level security;
    drop policy if exists "demo read" on hospitals;
    drop policy if exists "demo read" on resources;
    drop policy if exists "demo read" on emergency_requests;
    drop policy if exists "demo read" on reservations;
    create policy "demo read" on hospitals for select to anon, authenticated using (true);
    create policy "demo read" on resources for select to anon, authenticated using (true);
    create policy "demo read" on emergency_requests for select to anon, authenticated using (true);
    create policy "demo read" on reservations for select to anon, authenticated using (true);
  end if;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'resources') then
      alter publication supabase_realtime add table resources;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'emergency_requests') then
      alter publication supabase_realtime add table emergency_requests;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'hospitals') then
      alter publication supabase_realtime add table hospitals;
    end if;
  end if;
end;
$$;
