import { buildStatusChangeEvent } from './eventDispatcher';

// Phase 6 테스트용 — mock 데이터로 변화 감지 로직 확인
// 이 함수는 임시 테스트용이며, 실제 화면 코드에서는 쓰지 않는다.
export function testEventDispatcher() {
  console.log('테스트 1: 최초 상태 (이전 상태 없음) → 반드시 이벤트 발생해야 함');
  const status1 = {
    tripStatus: 'ON_BUS',
    remainingStations: 3,
    currentStation: { stationName: '수원대학교' },
    bellStatus: 'NOT_REQUESTED',
  };
  console.log(JSON.stringify(buildStatusChangeEvent(null, status1)));

  console.log('테스트 2: 완전히 동일한 상태 반복 → 이벤트 발생하면 안 됨 (null)');
  const status2 = { ...status1 };
  console.log(JSON.stringify(buildStatusChangeEvent(status1, status2)));

  console.log('테스트 3: remainingStations만 바뀜 → 이벤트 발생해야 함');
  const status3 = { ...status1, remainingStations: 2 };
  console.log(JSON.stringify(buildStatusChangeEvent(status1, status3)));

  console.log('테스트 4: currentStation.stationName만 바뀜 → 이벤트 발생해야 함');
  const status4 = { ...status1, currentStation: { stationName: '융건릉사거리' } };
  console.log(JSON.stringify(buildStatusChangeEvent(status1, status4)));

  console.log('테스트 5: bellStatus만 바뀜 → 이벤트 발생해야 함');
  const status5 = { ...status1, bellStatus: 'PENDING' };
  console.log(JSON.stringify(buildStatusChangeEvent(status1, status5)));
}