alter table public.trip_status
  drop constraint if exists trip_status_value_check;

alter table public.trip_status
  add constraint trip_status_value_check
    check (
      trip_status in (
        'WAITING_BUS',
        'ON_BUS',
        'NEAR_DESTINATION',
        'TRIP_DONE',
        'CANCELLED',
        'ERROR'
      )
    );

create or replace function public.save_trip_status_and_location(
  p_trip_id text,
  p_status jsonb,
  p_location_log jsonb,
  p_bell_request jsonb default null
)
returns text
language plpgsql
as $$
declare
  current_trip_status text;
begin
  update public.trip_status
  set
    current_station = nullif(p_status -> 'current_station', 'null'::jsonb),
    next_station = nullif(p_status -> 'next_station', 'null'::jsonb),
    remaining_stations = (p_status ->> 'remaining_stations')::integer,
    trip_status = p_status ->> 'trip_status',
    bell_status = p_status ->> 'bell_status',
    last_request_id = p_status ->> 'last_request_id',
    location_source = p_status ->> 'location_source',
    recorded_at = (p_status ->> 'recorded_at')::timestamptz,
    updated_at = (p_status ->> 'updated_at')::timestamptz
  where trip_id = p_trip_id
    and trip_status not in ('CANCELLED', 'TRIP_DONE');

  if not found then
    select trip_status
    into current_trip_status
    from public.trip_status
    where trip_id = p_trip_id;

    if current_trip_status = 'TRIP_DONE' then
      return 'TRIP_DONE';
    end if;

    return 'CANCELLED';
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
  );

  if p_bell_request is not null then
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

  return 'SAVED';
end;
$$;

create or replace function public.cancel_trip(
  p_trip_id text,
  p_updated_at timestamptz
)
returns text
language plpgsql
as $$
declare
  current_trip_status text;
begin
  select trip_status
  into current_trip_status
  from public.trip_status
  where trip_id = p_trip_id
  for update;

  if not found then
    return 'TRIP_NOT_FOUND';
  end if;

  if current_trip_status = 'TRIP_DONE' then
    return 'TRIP_DONE';
  end if;

  if current_trip_status = 'CANCELLED' then
    return 'ALREADY_CANCELLED';
  end if;

  update public.trip_status
  set
    trip_status = 'CANCELLED',
    updated_at = p_updated_at
  where trip_id = p_trip_id;

  return 'CANCELLED';
end;
$$;
