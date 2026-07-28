-- 동시(concurrent) 요청 레이스 수정:
-- 같은 (trip_id, request_id)로 두 PATCH /status 요청이 거의 동시에 들어오면,
-- 애플리케이션 레벨의 중복 검사(findLocationLogByRequestId)를 둘 다 통과한 뒤
-- 한쪽만 location_logs 삽입에 성공하고 나머지 하나는 UNIQUE 제약(location_logs_trip_request_unique)
-- 위반으로 예외가 발생해 500 DB_ERROR로 응답되는 문제가 있었다(2026-07-27 Codex 검수 발견).
-- INSERT에 ON CONFLICT DO NOTHING을 추가하고, 삽입이 실제로 일어났는지(FOUND)를 확인해
-- 충돌한 경우 예외 대신 'DUPLICATE' 문자열을 반환하도록 바꾼다.
-- 애플리케이션은 이 값을 기존 멱등 처리 경로와 동일하게 200으로 응답한다.

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
  )
  on conflict (trip_id, request_id) do nothing;

  if not found then
    -- 동시 요청 중 다른 하나가 같은 request_id를 먼저 저장했다.
    -- 트립 상태는 이미 위에서 갱신했으므로, 위치 로그·하차벨 로그는 만들지 않고
    -- 애플리케이션이 기존 멱등 경로와 동일하게 처리하도록 알린다.
    return 'DUPLICATE';
  end if;

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
