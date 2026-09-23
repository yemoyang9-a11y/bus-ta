-- Run after all migrations against an isolated local test database.
-- Every fixture and injected trigger is rolled back, including on disconnect.
begin;
do $$ begin
  if to_regprocedure('public.record_bell_result(text,text,text,text,boolean,timestamp with time zone)') is null then
    raise exception 'atomic bell result RPC is missing';
  end if;
end $$;

create function pg_temp.assert_true(ok boolean, label text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'assertion failed: %', label; end if;
end $$;

insert into public.trips (trip_id, destination, candidate_id, route_no, local_bus_id,
  gbis_station_id, boarding_station, destination_station, station_list)
select 't3-atomic-' || name, 'fixture', 1, 'T3', 'fixture-bus', 'fixture-station',
  '{}'::jsonb, '{}'::jsonb, '[{},{}]'::jsonb
from unnest(array['success','failure','legacy','cancelled','done','invalid','rollback','old','other']) as name;

insert into public.trip_status (trip_id, remaining_stations, trip_status, bell_status,
  boarding_method, boarding_confirmed_at, boarding_request_id)
select trip_id, 1,
  case trip_id when 't3-atomic-cancelled' then 'CANCELLED' when 't3-atomic-done' then 'TRIP_DONE' else 'NEAR_DESTINATION' end,
  case trip_id when 't3-atomic-invalid' then 'NOT_REQUESTED' else 'PENDING' end,
  'USER_CONFIRMED', '2026-09-22T09:00:00Z', 'fixture-boarding'
from public.trips where trip_id like 't3-atomic-%';

insert into public.bell_logs (trip_id, bell_request_id, requested_at)
select trip_id, 'bell-' || trip_id, '2026-09-22T09:00:01Z'
from public.trips where trip_id like 't3-atomic-%';

-- Historical two-PATCH failure: keep the original result and all metadata.
update public.bell_logs set result = 'SUCCESS', message = 'original', is_mock = false,
  completed_at = '2026-09-22T09:00:02Z' where trip_id = 't3-atomic-legacy';

do $$ declare saved jsonb; replay jsonb; begin
  saved := public.record_bell_result('t3-atomic-success','bell-t3-atomic-success','SUCCESS','first',false,'2026-09-22T09:00:02Z');
  perform pg_temp.assert_true(saved = '{"outcome":"SAVED","tripId":"t3-atomic-success","bellRequestId":"bell-t3-atomic-success","bellStatus":"SUCCESS","tripStatus":"NEAR_DESTINATION"}'::jsonb, 'first success');
  replay := public.record_bell_result('t3-atomic-success','bell-t3-atomic-success','SUCCESS','replacement',true,'2026-09-22T09:00:03Z');
  perform pg_temp.assert_true(replay->>'outcome' = 'ALREADY_RECORDED' and replay->>'bellStatus' = 'SUCCESS', 'identical retry');
  replay := public.record_bell_result('t3-atomic-success','bell-t3-atomic-success','FAIL','replacement',true,'2026-09-22T09:00:04Z');
  perform pg_temp.assert_true(replay->>'outcome' = 'ALREADY_RECORDED' and replay->>'bellStatus' = 'SUCCESS', 'conflicting retry preserves first result');
  perform pg_temp.assert_true((select result='SUCCESS' and message='first' and not is_mock and completed_at='2026-09-22T09:00:02Z' from public.bell_logs where trip_id='t3-atomic-success'), 'retry preserves original metadata');
  saved := public.record_bell_result('t3-atomic-failure','bell-t3-atomic-failure','FAIL','timeout',true,'2026-09-22T09:00:02Z');
  replay := public.record_bell_result('t3-atomic-failure','bell-t3-atomic-failure','SUCCESS',null,false,'2026-09-22T09:00:03Z');
  perform pg_temp.assert_true(saved->>'bellStatus'='FAIL' and replay->>'bellStatus'='FAIL', 'failure also wins');
  saved := public.record_bell_result('t3-atomic-legacy','bell-t3-atomic-legacy','FAIL','new',true,'2026-09-22T09:00:05Z');
  perform pg_temp.assert_true(saved->>'outcome'='ALREADY_RECORDED' and saved->>'bellStatus'='SUCCESS', 'legacy result wins');
  perform pg_temp.assert_true((select bell_status='SUCCESS' from public.trip_status where trip_id='t3-atomic-legacy'), 'legacy status repaired');
  perform pg_temp.assert_true((select message='original' and not is_mock and completed_at='2026-09-22T09:00:02Z' from public.bell_logs where trip_id='t3-atomic-legacy'), 'legacy metadata preserved');
end $$;

do $$ declare suffix text; saved jsonb; begin
  foreach suffix in array array['cancelled','done'] loop
    saved := public.record_bell_result('t3-atomic-'||suffix,'bell-t3-atomic-'||suffix,'SUCCESS',null,false,'2026-09-22T09:00:02Z');
    perform pg_temp.assert_true(saved->>'tripStatus'=case suffix when 'cancelled' then 'CANCELLED' else 'TRIP_DONE' end, 'terminal state returned');
    perform pg_temp.assert_true((select trip_status=saved->>'tripStatus' and bell_status='SUCCESS' from public.trip_status where trip_id='t3-atomic-'||suffix), 'terminal state preserved');
  end loop;
  saved := public.record_bell_result('missing','missing','SUCCESS',null,false,now());
  perform pg_temp.assert_true(saved->>'outcome'='BELL_REQUEST_NOT_FOUND', 'missing trip');
  saved := public.record_bell_result('t3-atomic-other','bell-t3-atomic-success','SUCCESS',null,false,now());
  perform pg_temp.assert_true(saved->>'outcome'='BELL_REQUEST_NOT_FOUND', 'request cannot cross trip');
  saved := public.record_bell_result('t3-atomic-invalid','bell-t3-atomic-invalid','SUCCESS',null,false,now());
  perform pg_temp.assert_true(saved->>'outcome'='INVALID_BELL_STATE', 'not requested rejected');
  perform pg_temp.assert_true((select result is null from public.bell_logs where trip_id='t3-atomic-invalid'), 'invalid state did not write');
  begin
    perform public.record_bell_result('t3-atomic-other','bell-t3-atomic-other','PENDING',null,false,now());
    raise exception 'invalid result accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- An older request must not heal or overwrite the current request's state.
insert into public.bell_logs (trip_id,bell_request_id,requested_at)
values ('t3-atomic-old','new-bell-t3-atomic-old','2026-09-22T09:00:02Z');
do $$ declare saved jsonb; begin
  saved := public.record_bell_result('t3-atomic-old','bell-t3-atomic-old','SUCCESS',null,false,now());
  perform pg_temp.assert_true(saved->>'outcome'='INVALID_BELL_STATE', 'old request rejected');
  perform pg_temp.assert_true((select bell_status='PENDING' from public.trip_status where trip_id='t3-atomic-old'), 'old request cannot update status');
end $$;

-- Force the second UPDATE to fail after the bell log UPDATE. Both must roll back.
create function pg_temp.fail_status_update() returns trigger language plpgsql as $$ begin
  if new.trip_id='t3-atomic-rollback' and new.bell_status in ('SUCCESS','FAIL') then
    raise exception 'injected second update failure' using errcode='P0002';
  end if;
  return new;
end $$;
create trigger t3_fail_status_update before update on public.trip_status
for each row execute function pg_temp.fail_status_update();
do $$ begin
  begin
    perform public.record_bell_result('t3-atomic-rollback','bell-t3-atomic-rollback','SUCCESS','must rollback',false,now());
    raise exception 'fault injection was not reached';
  exception when no_data_found then null;
  end;
  perform pg_temp.assert_true((select result is null and completed_at is null and message is null and is_mock from public.bell_logs where trip_id='t3-atomic-rollback'), 'bell log update rolled back');
  perform pg_temp.assert_true((select bell_status='PENDING' from public.trip_status where trip_id='t3-atomic-rollback'), 'status update rolled back');
end $$;

do $$ declare proc_oid oid := 'public.record_bell_result(text,text,text,text,boolean,timestamptz)'::regprocedure; begin
  perform pg_temp.assert_true((select not prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid=proc_oid), 'security invoker and empty search path');
  perform pg_temp.assert_true(not has_function_privilege('anon',proc_oid,'EXECUTE'), 'anon execute denied');
  perform pg_temp.assert_true(not has_function_privilege('authenticated',proc_oid,'EXECUTE'), 'authenticated execute denied');
  perform pg_temp.assert_true(has_function_privilege('service_role',proc_oid,'EXECUTE'), 'service role execute granted');
  perform pg_temp.assert_true(not exists(select 1 from pg_proc p, lateral aclexplode(p.proacl) a where p.oid=proc_oid and a.grantee=0 and a.privilege_type='EXECUTE'), 'PUBLIC execute revoked');
end $$;
set local role anon;
do $$ begin
  begin
    perform public.record_bell_result('t3-atomic-other','bell-t3-atomic-other','SUCCESS',null,false,now());
    raise exception 'anon executed protected RPC';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role service_role;
select public.record_bell_result('t3-atomic-other','bell-t3-atomic-other','SUCCESS',null,false,now());
reset role;
select pg_temp.assert_true((select bell_status='SUCCESS' from public.trip_status where trip_id='t3-atomic-other'), 'service role writes through RPC');
rollback;
\echo 'PASS: bell result atomicity, idempotency, legacy repair, terminal states, validation and ACL'
