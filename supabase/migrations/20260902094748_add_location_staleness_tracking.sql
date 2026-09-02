alter table public.trip_status
  add column if not exists last_latitude double precision,
  add column if not exists last_longitude double precision,
  add column if not exists location_changed_at timestamptz;

alter table public.trip_status
  add constraint trip_status_last_latitude_range
    check (last_latitude is null or last_latitude between -90 and 90),
  add constraint trip_status_last_longitude_range
    check (last_longitude is null or last_longitude between -180 and 180);
