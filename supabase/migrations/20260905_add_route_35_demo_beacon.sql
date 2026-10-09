-- 현재 실차 시연 노선 35의 비콘/하차벨 행을 보장한다.
--
-- fixture 단일 출처:
-- packages/shared/src/fixtures/demo-beacon.ts
--
-- Supabase 환경에서는 fixture fallback을 사용하지 않으므로,
-- 실제 bus_beacons 테이블에도 동일한 routeNo / targetBeaconId가 있어야 한다.
--
-- 기존 DB에 같은 beacon_id가 이미 있더라도 값이 어긋나 있을 수 있으므로
-- do nothing이 아니라 do update로 정렬한다.

insert into public.bus_beacons (
  beacon_id,
  route_no,
  target_beacon_id,
  is_mock,
  status
)
values (
  'BUSTA-35-DEMO01',
  '35',
  'BUS_35_001',
  false,
  'ACTIVE'
)
on conflict (beacon_id) do update
set
  route_no = excluded.route_no,
  target_beacon_id = excluded.target_beacon_id,
  is_mock = excluded.is_mock,
  status = excluded.status,
  updated_at = now();