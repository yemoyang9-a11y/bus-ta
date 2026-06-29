create extension if not exists pgcrypto;

create table if not exists public.trips (
  trip_id text primary key,
  user_id text,
  destination text not null,
  candidate_id integer,
  route_no text not null,
  local_bus_id text not null,
  gbis_station_id text not null,
  vehicle_id text,
  boarding_station jsonb not null,
  destination_station jsonb not null,
  station_list jsonb not null,
  total_time integer,
  total_walk integer,
  payment integer,
  bus_transit_count integer,
  bus_station_count integer,
  total_distance integer,
  interval_time integer,
  predicted_arrival_minutes integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint trips_station_list_is_array
    check (jsonb_typeof(station_list) = 'array'),
  constraint trips_station_list_has_minimum_stations
    check (jsonb_array_length(station_list) >= 2),
  constraint trips_boarding_station_is_object
    check (jsonb_typeof(boarding_station) = 'object'),
  constraint trips_destination_station_is_object
    check (jsonb_typeof(destination_station) = 'object'),
  constraint trips_candidate_id_nonnegative
    check (candidate_id is null or candidate_id >= 0),
  constraint trips_total_time_nonnegative
    check (total_time is null or total_time >= 0),
  constraint trips_total_walk_nonnegative
    check (total_walk is null or total_walk >= 0),
  constraint trips_payment_nonnegative
    check (payment is null or payment >= 0),
  constraint trips_bus_transit_count_nonnegative
    check (bus_transit_count is null or bus_transit_count >= 0),
  constraint trips_bus_station_count_nonnegative
    check (bus_station_count is null or bus_station_count >= 0),
  constraint trips_total_distance_nonnegative
    check (total_distance is null or total_distance >= 0),
  constraint trips_interval_time_nonnegative
    check (interval_time is null or interval_time >= 0),
  constraint trips_predicted_arrival_minutes_nonnegative
    check (predicted_arrival_minutes is null or predicted_arrival_minutes >= 0)
);

create table if not exists public.trip_status (
  status_id text primary key default gen_random_uuid()::text,
  trip_id text not null references public.trips(trip_id) on delete cascade,
  current_station jsonb,
  next_station jsonb,
  remaining_stations integer not null default 0,
  trip_status text not null default 'WAITING_BUS',
  bell_status text not null default 'NOT_REQUESTED',
  last_request_id text,
  location_source text,
  recorded_at timestamptz,
  updated_at timestamptz not null default now(),

  constraint trip_status_trip_id_unique unique (trip_id),
  constraint trip_status_remaining_stations_nonnegative
    check (remaining_stations >= 0),
  constraint trip_status_value_check
    check (trip_status in ('WAITING_BUS', 'ON_BUS', 'NEAR_DESTINATION', 'TRIP_DONE', 'ERROR')),
  constraint trip_status_bell_status_check
    check (bell_status in ('NOT_REQUESTED', 'PENDING', 'SUCCESS', 'FAIL')),
  constraint trip_status_location_source_check
    check (location_source is null or location_source in ('GPS', 'MOCK', 'MANUAL')),
  constraint trip_status_current_station_is_object
    check (current_station is null or jsonb_typeof(current_station) = 'object'),
  constraint trip_status_next_station_is_object
    check (next_station is null or jsonb_typeof(next_station) = 'object')
);

create table if not exists public.bell_logs (
  bell_log_id text primary key default gen_random_uuid()::text,
  trip_id text not null references public.trips(trip_id) on delete cascade,
  bell_request_id text not null,
  command text not null default 'STOP_REQUEST',
  result text,
  is_mock boolean not null default true,
  message text,
  retry_count integer not null default 0,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),

  constraint bell_logs_trip_request_unique unique (trip_id, bell_request_id),
  constraint bell_logs_command_check
    check (command = 'STOP_REQUEST'),
  constraint bell_logs_result_check
    check (result is null or result in ('SUCCESS', 'FAIL')),
  constraint bell_logs_retry_count_nonnegative
    check (retry_count >= 0)
);

create table if not exists public.bus_beacons (
  beacon_id text primary key,
  route_no text not null,
  local_bus_id text,
  vehicle_id text,
  target_beacon_id text not null,
  uuid text,
  major integer,
  minor integer,
  status text not null default 'ACTIVE',
  is_mock boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint bus_beacons_status_check
    check (status in ('ACTIVE', 'INACTIVE')),
  constraint bus_beacons_major_nonnegative
    check (major is null or major >= 0),
  constraint bus_beacons_minor_nonnegative
    check (minor is null or minor >= 0)
);

create table if not exists public.location_logs (
  location_log_id text primary key default gen_random_uuid()::text,
  trip_id text not null references public.trips(trip_id) on delete cascade,
  request_id text not null,
  latitude double precision not null,
  longitude double precision not null,
  source text not null,
  recorded_at timestamptz not null,
  current_station jsonb,
  remaining_stations integer not null,
  location_accepted boolean not null default true,
  reason text,
  created_at timestamptz not null default now(),

  constraint location_logs_trip_request_unique unique (trip_id, request_id),
  constraint location_logs_latitude_range
    check (latitude between -90 and 90),
  constraint location_logs_longitude_range
    check (longitude between -180 and 180),
  constraint location_logs_source_check
    check (source in ('GPS', 'MOCK', 'MANUAL')),
  constraint location_logs_remaining_stations_nonnegative
    check (remaining_stations >= 0),
  constraint location_logs_current_station_is_object
    check (current_station is null or jsonb_typeof(current_station) = 'object')
);

create index if not exists idx_trips_route_no
  on public.trips(route_no);

create index if not exists idx_trip_status_trip_id
  on public.trip_status(trip_id);

create index if not exists idx_bell_logs_trip_id
  on public.bell_logs(trip_id);

create index if not exists idx_bell_logs_bell_request_id
  on public.bell_logs(bell_request_id);

create index if not exists idx_bus_beacons_route_no
  on public.bus_beacons(route_no);

create index if not exists idx_bus_beacons_target_beacon_id
  on public.bus_beacons(target_beacon_id);

create index if not exists idx_location_logs_trip_id_created_at
  on public.location_logs(trip_id, created_at desc);
