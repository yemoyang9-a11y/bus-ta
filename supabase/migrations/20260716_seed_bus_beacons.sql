-- 시연 노선 1551 mock 비콘 시드
-- 단일 출처: packages/shared/src/fixtures/demo-beacon.ts (DEMO_BEACONS)
-- 실제 BUS_{routeToken}_{vehicleToken} 비콘 행은 정민 ESP32 준비 후 추가한다.
insert into public.bus_beacons (beacon_id, route_no, local_bus_id, target_beacon_id, is_mock, status)
values ('BUSTA-1551-DEMO01', '1551', '234001138', 'MOCK_BUS_1551_001', true, 'ACTIVE')
on conflict (beacon_id) do nothing;
