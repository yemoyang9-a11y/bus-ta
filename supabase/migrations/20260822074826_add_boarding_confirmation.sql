do $$
declare
  legacy_active_count integer;
begin
  select count(*)
  into legacy_active_count
  from public.trip_status
  where trip_status in ('ON_BUS', 'NEAR_DESTINATION');

  if legacy_active_count > 0 then
    raise exception
      'boarding confirmation migration blocked: % active legacy trip_status rows must be drained or cancelled first',
      legacy_active_count;
  end if;
end;
$$;

alter table public.trip_status
  add column if not exists boarding_method text,
  add column if not exists boarding_confirmed_at timestamptz,
  add column if not exists boarding_request_id text,
  add column if not exists boarding_detected_at timestamptz;

alter table public.trip_status
  add constraint trip_status_boarding_method_check
    check (boarding_method is null or boarding_method in ('USER_CONFIRMED', 'AUTO_DETECTED')),
  add constraint trip_status_boarding_evidence_shape_check
    check (
      (
        boarding_method is null
        and boarding_confirmed_at is null
        and boarding_request_id is null
        and boarding_detected_at is null
      )
      or
      (
        boarding_method is not null
        and boarding_confirmed_at is not null
        and boarding_request_id is not null
        and (boarding_method <> 'USER_CONFIRMED' or boarding_detected_at is null)
      )
    ),
  add constraint trip_status_boarding_state_check
    check (
      (trip_status <> 'WAITING_BUS' or boarding_confirmed_at is null)
      and
      (trip_status not in ('ON_BUS', 'NEAR_DESTINATION', 'TRIP_DONE') or boarding_confirmed_at is not null)
    ) not valid;

create or replace function public.confirm_trip_boarding(
  p_trip_id text,
  p_request_id text,
  p_boarding_method text,
  p_detected_at timestamptz,
  p_confirmed_at timestamptz
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_row public.trip_status%rowtype;
begin
  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'boarding request id is required';
  end if;

  if p_boarding_method not in ('USER_CONFIRMED', 'AUTO_DETECTED') then
    raise exception 'invalid boarding method';
  end if;

  if p_boarding_method = 'USER_CONFIRMED' and p_detected_at is not null then
    raise exception 'USER_CONFIRMED cannot include detected_at';
  end if;

  update public.trip_status
  set
    trip_status = case
      when remaining_stations = 1 then 'NEAR_DESTINATION'
      else 'ON_BUS'
    end,
    boarding_method = p_boarding_method,
    boarding_confirmed_at = p_confirmed_at,
    boarding_request_id = p_request_id,
    boarding_detected_at = p_detected_at,
    updated_at = p_confirmed_at
  where trip_id = p_trip_id
    and trip_status = 'WAITING_BUS'
    and boarding_method is null
    and boarding_confirmed_at is null
    and boarding_request_id is null;

  if found then
    return 'CONFIRMED';
  end if;

  select *
  into current_row
  from public.trip_status
  where trip_id = p_trip_id;

  if not found then
    return 'TRIP_NOT_FOUND';
  end if;

  if (
    (
      current_row.trip_status = 'WAITING_BUS'
      and (
        current_row.boarding_method is not null
        or current_row.boarding_confirmed_at is not null
        or current_row.boarding_request_id is not null
        or current_row.boarding_detected_at is not null
      )
    )
    or
    (
      current_row.trip_status in ('ON_BUS', 'NEAR_DESTINATION')
      and (
        current_row.boarding_method is null
        or current_row.boarding_confirmed_at is null
        or current_row.boarding_request_id is null
      )
    )
  ) then
    return 'INCONSISTENT';
  end if;

  if current_row.trip_status in ('ON_BUS', 'NEAR_DESTINATION') then
    return 'ALREADY_CONFIRMED';
  end if;

  return 'INVALID_STATUS';
end;
$$;

revoke execute
  on function public.confirm_trip_boarding(text, text, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute
  on function public.confirm_trip_boarding(text, text, text, timestamptz, timestamptz)
  to service_role;

-- Defense in depth: even if an old application instance asks for ON_BUS or a
-- bell request before confirmation, the database keeps WAITING_BUS and skips
-- the bell until boarding_confirmed_at exists.
create or replace function public.save_trip_status_and_location(
  p_trip_id text,
  p_status jsonb,
  p_location_log jsonb,
  p_bell_request jsonb default null
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_trip_status text;
  current_boarding_confirmed_at timestamptz;
  current_bell_status text;
  bell_created boolean := false;
begin
  select trip_status, boarding_confirmed_at, bell_status
  into current_trip_status, current_boarding_confirmed_at, current_bell_status
  from public.trip_status
  where trip_id = p_trip_id
  for update;

  if not found then
    return 'CANCELLED';
  end if;

  if current_trip_status = 'TRIP_DONE' then
    return 'TRIP_DONE';
  end if;

  if current_trip_status = 'CANCELLED' then
    return 'CANCELLED';
  end if;

  -- The application may have calculated WAITING_BUS before a concurrent
  -- boarding confirmation committed. Do not persist that stale snapshot or
  -- consume its request_id. The server will re-read the confirmed row and
  -- calculate ON_BUS / NEAR_DESTINATION / TRIP_DONE plus any bell request once.
  if current_boarding_confirmed_at is not null
     and p_status ->> 'trip_status' = 'WAITING_BUS' then
    return 'BOARDING_CONFIRMED_RETRY';
  end if;

  insert into public.location_logs (
    trip_id,
    request_id,
    latitude,
    longitude,
    source,
    recorded_at,
    current_station,
    remaining_stations,
    location_accepted,
    reason
  )
  values (
    p_trip_id,
    p_location_log ->> 'request_id',
    (p_location_log ->> 'latitude')::double precision,
    (p_location_log ->> 'longitude')::double precision,
    p_location_log ->> 'source',
    (p_location_log ->> 'recorded_at')::timestamptz,
    nullif(p_location_log -> 'current_station', 'null'::jsonb),
    (p_location_log ->> 'remaining_stations')::integer,
    (p_location_log ->> 'location_accepted')::boolean,
    p_location_log ->> 'reason'
  )
  on conflict (trip_id, request_id) do nothing;

  if not found then
    return 'DUPLICATE';
  end if;

  bell_created :=
    p_bell_request is not null
    and current_boarding_confirmed_at is not null
    and current_bell_status = 'NOT_REQUESTED'
    and (p_status ->> 'remaining_stations')::integer = 1;

  update public.trip_status
  set
    current_station = nullif(p_status -> 'current_station', 'null'::jsonb),
    next_station = nullif(p_status -> 'next_station', 'null'::jsonb),
    remaining_stations = (p_status ->> 'remaining_stations')::integer,
    trip_status = case
      when boarding_confirmed_at is null then 'WAITING_BUS'
      -- A GPS request can be calculated from a pre-confirmation snapshot and
      -- arrive after confirm_trip_boarding commits. Preserve the confirmed DB
      -- state instead of applying that stale WAITING_BUS value.
      when p_status ->> 'trip_status' = 'WAITING_BUS' then trip_status
      else p_status ->> 'trip_status'
    end,
    -- Only the transaction holding the row lock may perform the
    -- NOT_REQUESTED -> PENDING transition. Stale payloads cannot create a
    -- second authoritative STOP_REQUEST.
    bell_status = case when bell_created then 'PENDING' else current_bell_status end,
    last_request_id = p_status ->> 'last_request_id',
    location_source = p_status ->> 'location_source',
    recorded_at = (p_status ->> 'recorded_at')::timestamptz,
    updated_at = (p_status ->> 'updated_at')::timestamptz
  where trip_id = p_trip_id
  returning trip_status, boarding_confirmed_at
  into current_trip_status, current_boarding_confirmed_at;

  if bell_created then
    insert into public.bell_logs (
      trip_id,
      bell_request_id,
      command,
      requested_at
    )
    values (
      p_trip_id,
      p_bell_request ->> 'bell_request_id',
      p_bell_request ->> 'command',
      (p_bell_request ->> 'requested_at')::timestamptz
    );
  end if;

  if bell_created then
    return 'SAVED_BELL_CREATED';
  end if;

  return 'SAVED';
end;
$$;
