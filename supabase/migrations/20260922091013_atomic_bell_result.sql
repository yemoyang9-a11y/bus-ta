-- Apply before deploying the server that uses this RPC. No public REST contract changes.
create or replace function public.record_bell_result(
  p_trip_id text,
  p_bell_request_id text,
  p_result text,
  p_message text,
  p_is_mock boolean,
  p_completed_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_status public.trip_status%rowtype;
  current_bell public.bell_logs%rowtype;
  saved_result text;
  saved_outcome text;
begin
  if p_result is null or p_result not in ('SUCCESS', 'FAIL')
     or p_trip_id is null or p_trip_id = ''
     or p_bell_request_id is null or p_bell_request_id = ''
     or p_is_mock is null or p_completed_at is null then
    raise exception 'invalid bell result parameters' using errcode = '22023';
  end if;

  -- Same lock order as GPS/boarding/cancellation. Never take a bell row first.
  select * into current_status from public.trip_status
  where trip_id = p_trip_id for update;
  if not found then
    return jsonb_build_object('outcome', 'BELL_REQUEST_NOT_FOUND');
  end if;

  select * into current_bell from public.bell_logs
  where trip_id = p_trip_id
  order by requested_at desc, created_at desc, bell_log_id desc
  limit 1 for update;
  if not found then
    return jsonb_build_object('outcome', 'BELL_REQUEST_NOT_FOUND');
  end if;
  if current_bell.bell_request_id <> p_bell_request_id then
    if exists (select 1 from public.bell_logs
      where trip_id = p_trip_id and bell_request_id = p_bell_request_id) then
      return jsonb_build_object('outcome', 'INVALID_BELL_STATE');
    end if;
    return jsonb_build_object('outcome', 'BELL_REQUEST_NOT_FOUND');
  end if;

  if current_bell.result is not null then
    -- First result and its metadata remain authoritative, even for a conflicting retry.
    saved_result := current_bell.result;
    saved_outcome := 'ALREADY_RECORDED';
  else
    if current_status.bell_status <> 'PENDING' then
      return jsonb_build_object('outcome', 'INVALID_BELL_STATE');
    end if;
    saved_result := p_result;
    saved_outcome := 'SAVED';
    update public.bell_logs set result = p_result, message = p_message,
      is_mock = p_is_mock, completed_at = p_completed_at
    where bell_log_id = current_bell.bell_log_id;
    if not found then raise exception 'bell result update did not persist'; end if;
  end if;

  -- Also heals records left by the legacy two-PATCH implementation. A failure
  -- here rolls back the bell_logs UPDATE above. Never change trip_status itself.
  if current_status.bell_status is distinct from saved_result then
    update public.trip_status set bell_status = saved_result,
      updated_at = greatest(current_status.updated_at, p_completed_at)
    where trip_id = p_trip_id;
    if not found then raise exception 'bell status update did not persist'; end if;
  end if;

  return jsonb_build_object('outcome', saved_outcome, 'tripId', p_trip_id,
    'bellRequestId', p_bell_request_id, 'bellStatus', saved_result,
    'tripStatus', current_status.trip_status);
end;
$$;

revoke execute on function public.record_bell_result(text, text, text, text, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_bell_result(text, text, text, text, boolean, timestamptz)
  to service_role;
