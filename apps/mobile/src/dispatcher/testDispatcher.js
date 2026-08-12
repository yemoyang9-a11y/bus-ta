import { dispatchFunctionCall } from './functionDispatcher';

// Phase 5 테스트용 — 가짜 tripState로 실제 API 호출 확인
// 이 함수는 임시 테스트용이며, 실제 화면 코드에서는 쓰지 않는다.
export async function testSearchRoutes() {
  const fakeTripState = {
    tripId: null,
    selectedRoute: null,
    destination: null,
  };

  console.log('테스트: search_routes 호출 시작');
  const result = await dispatchFunctionCall(
    'search_routes',
    { destination: '병점역', latitude: 37.213789, longitude: 126.979772 },
    fakeTripState
  );
  console.log('테스트: search_routes 결과', JSON.stringify(result));
  return result;
}