-- Keep new objects created by repository migrations out of the Data API until
-- the same migration grants the minimum role privileges explicitly.

alter default privileges for role postgres in schema public
  revoke all privileges on tables from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke all privileges on functions from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke all privileges on sequences from public, anon, authenticated, service_role;

-- The first security migration removed Data API CRUD access. Remove the
-- remaining table privileges as well so the server-only contract is exact.
revoke all privileges
  on table public.trips, public.trip_status, public.location_logs,
    public.bell_logs, public.bus_beacons
  from public, anon, authenticated;

grant select, insert, update, delete
  on table public.trips, public.trip_status, public.location_logs,
    public.bell_logs, public.bus_beacons
  to service_role;
