-- Keep the backend data API server-only until user authentication and ownership
-- policies are part of the shared contract.  Do not add anon/authenticated
-- policies here: the REST API uses the service_role key exclusively.

alter table public.trips enable row level security;
alter table public.trip_status enable row level security;
alter table public.location_logs enable row level security;
alter table public.bell_logs enable row level security;
alter table public.bus_beacons enable row level security;

revoke select, insert, update, delete
  on table public.trips, public.trip_status, public.location_logs,
    public.bell_logs, public.bus_beacons
  from public, anon, authenticated;

grant select, insert, update, delete
  on table public.trips, public.trip_status, public.location_logs,
    public.bell_logs, public.bus_beacons
  to service_role;

alter function public.save_trip_status_and_location(text, jsonb, jsonb, jsonb)
  security invoker;
alter function public.save_trip_status_and_location(text, jsonb, jsonb, jsonb)
  set search_path = '';

revoke execute
  on function public.save_trip_status_and_location(text, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute
  on function public.save_trip_status_and_location(text, jsonb, jsonb, jsonb)
  to service_role;

alter function public.cancel_trip(text, timestamptz)
  security invoker;
alter function public.cancel_trip(text, timestamptz)
  set search_path = '';

revoke execute
  on function public.cancel_trip(text, timestamptz)
  from public, anon, authenticated;
grant execute
  on function public.cancel_trip(text, timestamptz)
  to service_role;
