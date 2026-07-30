# 프론트엔드 개발 지침

> 문서 상태: 최종 개발 기준. 앱은 접근성 UI·Realtime 연결·Dispatcher·GPS·BLE를 담당하고, 백엔드가 운행 사실을 판정한다.

## 현재 전환 방향

과거 mock 화면은 시연 이력으로 남기되, 최종 앱은 mock 응답·고정 `tripId`·고정 연결 플래그에 의존하지 않는다. 실제 연결 전 기능은 구현 완료로 표시하지 않는다.

## Realtime 세션과 Dispatcher

1. 앱은 `POST /api/realtime/session`으로 단기 키를 받고 WebRTC 세션을 연다.
2. 연결 후 앱이 `instructions`와 Function tools를 설정한다.
3. Function 호출은 앱 내부 Dispatcher가 REST API로 변환한다.
4. REST 결과를 세션에 되돌리고, 오류는 `errorCode`와 사용자용 안내로 처리한다.

Function 매핑은 `search_routes → POST /api/routes/search`, `create_trip → POST /api/trips`, `get_trip_status → GET /api/trips/{tripId}/status`, `end_trip → PATCH /api/trips/{tripId}`이다. 모델이 `tripId`, 좌표, `requestId`, `bellRequestId`를 만들도록 두지 않는다.

## 앱 상태와 자동 이벤트

앱 상태는 목적지, 최근 후보, 선택 후보, `tripId`, 운행 진행 여부와 최근 결과를 보관한다. Realtime 대화 기억은 상태 저장소가 아니다.

- 운행 중 약 3초마다 GPS 또는 명시적 mock 위치를 `PATCH /api/trips/{tripId}/status`로 보낸다.
- 종료·취소 상태면 새 위치 전송을 멈춘다.
- 상태가 실제로 변했을 때만 Event Dispatcher가 Realtime 세션에 알린다.
- `GET /status`는 조회 전용이므로 하차벨을 실행하지 않는다.

## BLE와 접근성

`GET /api/beacons?routeNo=`의 `targetBeaconId`를 스마트지팡이에 전달한다. `PATCH /status` 응답에서만 `shouldTriggerBell: true`, `bellRequestId`, `STOP_REQUEST`를 받고 하차벨로 보낸 뒤 결과를 `POST /bell/result`로 기록한다.

마이크·위치·BLE 권한 거부, Realtime 연결 끊김, 네트워크·외부 API 오류는 사용자가 이해할 수 있는 음성·화면 안내로 처리한다. `EXPO_PUBLIC_` 환경 변수에는 장기 API 키나 백엔드 공유 비밀을 넣지 않는다.
