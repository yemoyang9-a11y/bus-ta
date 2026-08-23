begin;

insert into public.trips (
  trip_id,
  destination,
  candidate_id,
  route_no,
  local_bus_id,
  gbis_station_id,
  boarding_station,
  destination_station,
  station_list
)
values (
  'trip-boarding-race-test',
  '수원대학교',
  1,
  '700-2',
  'local-bus-test',
  'station-test',
  '{"stationName":"승차 정류장"}'::jsonb,
  '{"stationName":"하차 정류장"}'::jsonb,
  '[{"stationName":"승차 정류장"},{"stationName":"하차 정류장"}]'::jsonb
);

insert into public.trip_status (
  trip_id,
  remaining_stations,
  trip_status,
  bell_status
)
values (
  'trip-boarding-race-test',
  3,
  'WAITING_BUS',
  'NOT_REQUESTED'
);

do $$
declare
  confirmation_result text;
begin
  confirmation_result := public.confirm_trip_boarding(
    'trip-boarding-race-test',
    'boarding-race-confirm',
    'USER_CONFIRMED',
    null,
    '2026-08-22T01:00:00.000Z'::timestamptz
  );

  if confirmation_result <> 'CONFIRMED' then
    raise exception 'expected CONFIRMED, got %', confirmation_result;
  end if;
end;
$$;

-- This location payload was calculated from a WAITING_BUS snapshot before the
-- confirmation transaction committed. Saving it afterwards must not regress
-- the authoritative confirmed state or fail the request.
do $$
declare
  save_result text;
  saved_trip_status text;
begin
  save_result := public.save_trip_status_and_location(
    'trip-boarding-race-test',
    jsonb_build_object(
      'current_station', jsonb_build_object('stationName', '중간 정류장'),
      'next_station', jsonb_build_object('stationName', '하차 정류장'),
      'remaining_stations', 2,
      'trip_status', 'WAITING_BUS',
      'bell_status', 'NOT_REQUESTED',
      'last_request_id', 'location-race-stale',
      'location_source', 'GPS',
      'recorded_at', '2026-08-22T01:00:01.000Z',
      'updated_at', '2026-08-22T01:00:01.000Z'
    ),
    jsonb_build_object(
      'request_id', 'location-race-stale',
      'latitude', 37.0,
      'longitude', 127.0,
      'source', 'GPS',
      'recorded_at', '2026-08-22T01:00:01.000Z',
      'current_station', jsonb_build_object('stationName', '중간 정류장'),
      'remaining_stations', 2,
      'location_accepted', true,
      'reason', null
    ),
    null
  );

  select trip_status
  into saved_trip_status
  from public.trip_status
  where trip_id = 'trip-boarding-race-test';

  if save_result <> 'SAVED' then
    raise exception 'expected SAVED, got %', save_result;
  end if;

  if saved_trip_status <> 'ON_BUS' then
    raise exception 'expected ON_BUS, got %', saved_trip_status;
  end if;
end;
$$;

-- Two GPS requests can both be calculated from the same NOT_REQUESTED
-- snapshot. Only the transaction that wins the database transition may
-- create a bell log; the stale second payload must be saved without a second
-- STOP_REQUEST.
do $$
declare
  first_save_result text;
  second_save_result text;
  saved_bell_status text;
  bell_log_count integer;
begin
  first_save_result := public.save_trip_status_and_location(
    'trip-boarding-race-test',
    jsonb_build_object(
      'current_station', jsonb_build_object('stationName', '하차 전 정류장'),
      'next_station', jsonb_build_object('stationName', '하차 정류장'),
      'remaining_stations', 1,
      'trip_status', 'NEAR_DESTINATION',
      'bell_status', 'PENDING',
      'last_request_id', 'location-bell-first',
      'location_source', 'GPS',
      'recorded_at', '2026-08-22T01:00:02.000Z',
      'updated_at', '2026-08-22T01:00:02.000Z'
    ),
    jsonb_build_object(
      'request_id', 'location-bell-first',
      'latitude', 37.1,
      'longitude', 127.1,
      'source', 'GPS',
      'recorded_at', '2026-08-22T01:00:02.000Z',
      'current_station', jsonb_build_object('stationName', '하차 전 정류장'),
      'remaining_stations', 1,
      'location_accepted', true,
      'reason', null
    ),
    jsonb_build_object(
      'bell_request_id', 'bell-first',
      'command', 'STOP_REQUEST',
      'requested_at', '2026-08-22T01:00:02.000Z'
    )
  );

  second_save_result := public.save_trip_status_and_location(
    'trip-boarding-race-test',
    jsonb_build_object(
      'current_station', jsonb_build_object('stationName', '하차 전 정류장'),
      'next_station', jsonb_build_object('stationName', '하차 정류장'),
      'remaining_stations', 1,
      'trip_status', 'NEAR_DESTINATION',
      'bell_status', 'PENDING',
      'last_request_id', 'location-bell-second',
      'location_source', 'GPS',
      'recorded_at', '2026-08-22T01:00:03.000Z',
      'updated_at', '2026-08-22T01:00:03.000Z'
    ),
    jsonb_build_object(
      'request_id', 'location-bell-second',
      'latitude', 37.1,
      'longitude', 127.1,
      'source', 'GPS',
      'recorded_at', '2026-08-22T01:00:03.000Z',
      'current_station', jsonb_build_object('stationName', '하차 전 정류장'),
      'remaining_stations', 1,
      'location_accepted', true,
      'reason', null
    ),
    jsonb_build_object(
      'bell_request_id', 'bell-second',
      'command', 'STOP_REQUEST',
      'requested_at', '2026-08-22T01:00:03.000Z'
    )
  );

  select bell_status
  into saved_bell_status
  from public.trip_status
  where trip_id = 'trip-boarding-race-test';

  select count(*)
  into bell_log_count
  from public.bell_logs
  where trip_id = 'trip-boarding-race-test';

  if first_save_result <> 'SAVED_BELL_CREATED' then
    raise exception 'expected first save to create bell, got %', first_save_result;
  end if;

  if second_save_result <> 'SAVED' then
    raise exception 'expected second save not to create bell, got %', second_save_result;
  end if;

  if saved_bell_status <> 'PENDING' then
    raise exception 'expected PENDING bell status, got %', saved_bell_status;
  end if;

  if bell_log_count <> 1 then
    raise exception 'expected exactly one bell log, got %', bell_log_count;
  end if;
end;
$$;

rollback;
