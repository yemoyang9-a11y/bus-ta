# 프론트엔드 개발 지침

> 문서 상태: 최종 개발 기준. 앱은 접근성 UI·Realtime 연결·Dispatcher·GPS·BLE를 담당하고, 백엔드가 운행 사실을 판정한다.

## 현재 전환 방향

과거 mock 화면은 시연 이력으로 남기되, 최종 앱은 mock 응답·고정 `tripId`·고정 연결 플래그에 의존하지 않는다. 실제 연결 전 기능은 구현 완료로 표시하지 않는다.

## Realtime 세션과 Dispatcher

1. 앱은 `POST /api/realtime/session`으로 단기 키를 받고 WebRTC 세션을 연다.
2. 연결 후 앱이 `instructions`와 Function tools를 설정한다.
3. Function 호출은 앱 내부 Dispatcher가 REST API로 변환한다.
4. REST 결과를 세션에 되돌리고, 오류는 `errorCode`와 사용자용 안내로 처리한다.

Function 매핑은 `search_routes → POST /api/routes/search`, `create_trip → POST /api/trips`, `confirm_boarding → POST /api/trips/{tripId}/boarding/confirm`, `get_trip_status → GET /api/trips/{tripId}/status`, `end_trip → PATCH /api/trips/{tripId}`이다. `get_next_route_candidates`는 REST API를 호출하지 않고 앱에 보관된 기존 후보에서 아직 안내하지 않은 다음 후보를 고르는 로컬 Function이다. `confirm_boarding`은 모델이 빈 객체만 보내고 Dispatcher가 활성 `tripId`, 전용 `requestId`, `USER_CONFIRMED`를 채운다. 모델이 식별자·좌표·판정값을 만들도록 두지 않는다. `confirm_boarding`과 `end_trip` 응답의 `tripId`가 현재 활성 운행과 다르면 `STALE_TRIP_CONTEXT`로 처리하고 TripContext를 변경하지 않는다.

## 앱 상태와 자동 이벤트

앱 상태는 목적지, 최근 후보, 선택 후보, `tripId`, 운행 진행 여부와 최근 결과를 보관한다. Realtime 대화 기억은 상태 저장소가 아니다.

- 운행 중 약 3초마다 GPS 또는 명시적 mock 위치를 `PATCH /api/trips/{tripId}/status`로 보낸다.
- 탑승확정 전 GPS 응답은 `WAITING_BUS`로 유지한다. 화면 제목은 `버스 탑승 대기`이며 서버가 보낸 `boardingConfirmedAt`이 생긴 뒤에만 `탑승 중`으로 바꾼다.
- 종료·취소 상태면 새 위치 전송을 멈춘다.
- 정상 도착은 전체 상태를 초기화하지만, 사용자 취소는 검색 성공 후 5분 동안 현재 앱 세션 메모리의 목적지·경로 후보·안내 기록을 유지해 새 검색 없이 다시 선택할 수 있게 한다. 앱을 재시작하면 메모리 후보는 폐기한다. A 운행 취소 직후 B 후보를 선택하면 A의 실제 비콘 스캔 중지 완료를 먼저 기다린 뒤 B 운행 생성과 새 대상 비콘 설정을 시작한다.
- 상태가 실제로 변했을 때만 Event Dispatcher가 Realtime 세션에 알린다.
- `GET /status`는 조회 전용이므로 하차벨을 실행하지 않는다.

### 도착정보 반복 조회

대기 중에는 서버가 준 `nextArrivalRefreshInMs` 주기로 `GET /api/trips/{tripId}/status`를 다시 부른다. 주기를 앱이 스스로 정하면 서버의 GBIS 호출 정책과 어긋난다. 값이 없으면 반복하지 않으며, 서버는 `WAITING_BUS`에서만 주기를 주므로 탑승이 확정되면 폴링은 자연히 멈춘다.

이 경로가 도착 예정 시간을 갱신하는 유일한 경로다. 그러므로 응답을 받으면 화면 state와 `UPDATE_TRIP_STATUS`뿐 아니라 `session.notifyStatusChange()`까지 함께 호출한다. 여기서 세션에 알리지 않으면 서버가 3분·2분을 내려줘도 AI는 `create_trip` 때의 값만 알고 있게 된다(2026-09-05 시연에서 실제로 발생). React의 `dispatch`는 비동기라 dispatch 직후 context를 다시 읽지 말고, 방금 받은 응답을 `toTripStatusSnapshot()`으로 감싸 그대로 넘긴다.

앱 공통 상태(`state/trip-reducer.js`)는 `arrivals`, `arrivalStatus`, `nextArrivalRefreshInMs`, `shouldScanBeacon`을 보관한다. 이 네 필드는 대기 중 `GET /status` 응답에만 있고 3초 주기 `PATCH /status` 응답에는 없으므로, 없는 값을 그대로 덮어쓰면 방금 받은 최신 도착시간이 지워진다. 규칙은 셋이다.

1. 응답에 도착정보가 있으면 그대로 최신 값으로 바꾼다.
2. 없는데 `WAITING_BUS`도 벗어났으면(탑승 확정·운행 종료) 명시적으로 비운다.
3. 없지만 아직 대기 중이면 직전 값을 유지한다.

`realtime/event-dispatcher.ts`도 같은 규칙을 쓴다. 이 값이 임박 판정의 기준이라, PATCH 응답이 끼어들 때 잊어버리면 같은 임박 안내가 두 번 나간다.

## BLE와 접근성

`GET /api/beacons?routeNo=`의 `targetBeaconId`를 스마트지팡이에 전달한다. BLE 신호 수집과 자동 탑승 여부의 최종 알고리즘 판정은 프론트 BLE 모듈이 담당한다. 자동 확정 시 `apiClient.trips.confirmBoarding(tripId, { requestId, boardingMethod: "AUTO_DETECTED", detectedAt })`를 호출하고, 서버 성공 응답만 앱 상태에 반영한다.

사용자가 음성으로 탑승을 명시하면 `confirm_boarding` Function 경로가 즉시 `USER_CONFIRMED`를 전송한다. 이 경로는 BLE·GPS 결과를 기다리지 않는다. 어느 경로든 `boardingConfirmedAt`이 확인된 뒤에만 비콘 스캔을 중지한다. `PATCH /status` 응답에서만 `shouldTriggerBell: true`, `bellRequestId`, `STOP_REQUEST`를 받고 하차벨로 보낸 뒤 결과를 `POST /bell/result`로 기록한다.

마이크·위치·BLE 권한 거부, Realtime 연결 끊김, 네트워크·외부 API 오류는 사용자가 이해할 수 있는 음성·화면 안내로 처리한다. `EXPO_PUBLIC_` 환경 변수에는 장기 API 키나 백엔드 공유 비밀을 넣지 않는다.

지팡이·하차벨 준비 실패는 기기별 결과를 구분해 `assist_device_status_changed` 이벤트로 Realtime 세션에 전달한다. 노선 비콘 미등록·조회 실패는 지팡이 접근 진동 준비 실패로만 다루고 `attempted: false`로 기록한다. 이 경우에도 하차벨 BLE 연결은 별도로 계속 시도하며, 사용자 기기의 전원이나 하차벨 실패를 원인으로 단정하지 않는다. Realtime 연결이 없으면 같은 내용을 로컬 TTS로 안내한다.
