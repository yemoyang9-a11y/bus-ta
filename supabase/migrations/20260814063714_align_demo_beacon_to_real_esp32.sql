-- 시연 노선 1551 비콘을 정민 ESP32 실물에 맞춘다.
-- 단일 출처: packages/shared/src/fixtures/demo-beacon.ts (DEMO_BEACONS)
--
-- 배경: 20260716_seed_bus_beacons.sql 은 하드웨어 준비 전이라 mock 값
-- ('MOCK_BUS_1551_001', is_mock=true)으로 시드했다. 이후 펌웨어
-- (feature/hardware-bus-beacon 의 beacon_bell.ino)가 'BUS_1551_001' 이름으로
-- 광고하도록 확정되어, GET /api/beacons 가 내려주는 targetBeaconId 와
-- 실제 광고 이름이 어긋난 상태였다. 앱이 그 값을 그대로 스마트지팡이에
-- 넘기므로(RouteListScreen.setTargetBeacon) 어긋나면 탑승 안내 진동이 울리지 않는다.
--
-- 기존 시드는 on conflict (beacon_id) do nothing 이라 파일을 고쳐도 이미 적용된
-- 행은 갱신되지 않는다. 그래서 별도 update migration 으로 처리한다.
update public.bus_beacons
   set target_beacon_id = 'BUS_1551_001',
       is_mock = false,
       updated_at = now()
 where beacon_id = 'BUSTA-1551-DEMO01';
