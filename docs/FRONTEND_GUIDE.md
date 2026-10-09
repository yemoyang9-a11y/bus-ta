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

환승 후보는 `journeySupported=true`일 때 화면 선택 또는 `start_journey(candidateId)`로 앱 여정을 시작한다. `confirm_journey_step(step)`은 도보 도착·지하철 탑승/하차·버스 실제 하차를 현재 단계와 대조한다. `start_journey_bus({})`만 현재 버스 segment의 `busLeg`를 사용해 기존 `POST /api/trips`를 호출한다. 모델이 버스 구간 식별자나 정류장을 다시 조립하지 않는다. 환승 후보 전체에 `create_trip`을 호출하지 않는다.

## 앱 상태와 자동 이벤트

직행 버스의 음성 `create_trip`과 카드 선택은 공통 생성 작업을 사용한다. 같은 검색 후보·선택 세대에서 같은 후보의 요청은 결과를 공유하며, 다른 후보의 동시 생성은 거절한다. 성공 시에만 선택 노선과 `tripId`를 함께 반영하고, 활성 `RouteListScreen`이 유효한 운행 상태를 보고 `RidingScreen`으로 이동한다. 비활성 `MainScreen`의 포커스 제한은 유지한다. 생성 실패 시 다시 선택할 수 있으며, 취소·재검색·환승 시작으로 선택 세대가 바뀌면 이전 응답을 적용하지 않는다. 선택 세대는 앱 내부 경쟁 방지 값이며 공개 API나 DB 필드가 아니다.

앱 상태는 목적지, 최근 후보, 선택 후보, `tripId`, 운행 진행 여부와 최근 결과를 보관한다. Realtime 대화 기억은 상태 저장소가 아니다.

- 운행 중 GPS watch는 약 2초 간격을 요청하며(실제 간격은 OS에 따라 다름), 새 GPS 또는 명시적 mock 위치를 `PATCH /api/trips/{tripId}/status`로 보낸다.
- 탑승확정 전 GPS 응답은 `WAITING_BUS`로 유지한다. 화면 제목은 `버스 탑승 대기`이며 서버가 보낸 `boardingConfirmedAt`이 생긴 뒤에만 `탑승 중`으로 바꾼다.
- 종료·취소 상태면 새 위치 전송을 멈춘다.
- 직행 버스의 정상 도착은 전체 상태를 초기화한다. 환승 여정에서는 버스의 `TRIP_DONE` 후 `BUS_ALIGHT_CONFIRM`으로 이동하고, 실제 하차 확인 뒤 해당 버스 상태만 정리한 채 다음 구간을 유지한다. 마지막 구간 확인 후 전체 상태를 초기화한다. 사용자 취소는 검색 성공 후 5분 동안 현재 앱 세션 메모리의 목적지·경로 후보·안내 기록을 유지해 다시 선택할 수 있게 한다. 앱을 재시작하면 메모리 후보와 여정 진행 상태는 폐기된다. A 운행 취소 직후 B 후보를 선택하면 A의 실제 비콘 스캔 중지 완료를 먼저 기다린 뒤 B 운행 생성과 새 대상 비콘 설정을 시작한다.
- 상태가 실제로 변했을 때만 Event Dispatcher가 Realtime 세션에 알린다.
- `GET /status`는 조회 전용이므로 하차벨을 실행하지 않는다.

### 도착정보 반복 조회

대기 중에는 서버가 준 `nextArrivalRefreshInMs` 주기로 `GET /api/trips/{tripId}/status`를 다시 부른다. 주기를 앱이 스스로 정하면 서버의 GBIS 호출 정책과 어긋난다. 0은 1000ms로 올리고, 값이 없거나 음수·NaN·Infinity인 경우에만 15000ms를 사용한다. 응답마다 setTimeout을 다시 예약하며 실패도 15000ms 뒤 재예약한다. 탑승 확정·취소·운행 교체 시 예약과 늦은 응답을 폐기한다. 화면 이동은 운행 종료가 아니므로 Provider가 계속 관리한다.

이 경로가 도착 예정 시간을 갱신하는 유일한 경로다. 그러므로 응답을 받으면 화면 state와 `UPDATE_TRIP_STATUS`뿐 아니라 `session.notifyStatusChange()`까지 함께 호출한다. 여기서 세션에 알리지 않으면 서버가 3분·2분을 내려줘도 AI는 `create_trip` 때의 값만 알고 있게 된다(2026-09-05 시연에서 실제로 발생). React의 `dispatch`는 비동기라 dispatch 직후 context를 다시 읽지 말고, 방금 받은 응답을 `toTripStatusSnapshot()`으로 감싸 그대로 넘긴다.

앱 공통 상태(`state/trip-reducer.ts`)는 `arrivals`, `arrivalStatus`, `nextArrivalRefreshInMs`, `shouldScanBeacon`을 보관한다. 이 네 필드는 대기 중 `GET /status` 응답에만 있고 GPS `PATCH /status` 응답에는 없으므로, 없는 값을 그대로 덮어쓰면 방금 받은 최신 도착시간이 지워진다. 규칙은 셋이다.

1. 응답에 도착정보가 있으면 그대로 최신 값으로 바꾼다.
2. 없는데 `WAITING_BUS`도 벗어났으면(탑승 확정·운행 종료) 명시적으로 비운다.
3. 없지만 아직 대기 중이면 직전 값을 유지한다.

`realtime/event-dispatcher.ts`도 같은 규칙을 쓴다. 이 값이 임박 판정의 기준이라, PATCH 응답이 끼어들 때 잊어버리면 같은 임박 안내가 두 번 나간다.

## BLE와 접근성

`GET /api/beacons?routeNo=`의 `targetBeaconId`를 스마트지팡이에 전달한다. BLE 신호 수집과 자동 탑승 여부의 최종 알고리즘 판정은 프론트 BLE 모듈이 담당한다. 자동 확정 시 `apiClient.trips.confirmBoarding(tripId, { requestId, boardingMethod: "AUTO_DETECTED", detectedAt })`를 호출하고, 서버 성공 응답만 앱 상태에 반영한다.

운행 준비 시 앱은 하차벨을 기다리지 않고 `White_cane`만 먼저 연결한다. 서비스와 Characteristic 탐색이 끝나면 같은 GATT 연결에 `SET_TARGET_BEACON`을 Write하고, 그 Promise가 성공한 뒤 `START_BEACON_SCAN`을 Write한다. 두 번째 Write까지 성공했을 때만 `beaconScanActive`를 `true`로 기록한다. 서버의 `shouldScanBeacon` 처리는 준비 단계 명령이 실패했거나 아직 시작되지 않은 경우의 재시도 경로로 유지한다.

사용자가 음성으로 탑승을 명시하면 `confirm_boarding` Function 경로가 즉시 `USER_CONFIRMED`를 전송한다. 이 경로는 BLE·GPS 결과를 기다리지 않는다. 어느 경로든 `boardingConfirmedAt`이 확인된 뒤에만 비콘 스캔을 중지한다. `PATCH /status` 응답에서만 `shouldTriggerBell: true`, `bellRequestId`, `STOP_REQUEST`를 받고 하차벨로 보낸 뒤 결과를 `POST /bell/result`로 기록한다.

마이크·위치·BLE 권한 거부, Realtime 연결 끊김, 네트워크·외부 API 오류는 사용자가 이해할 수 있는 음성·화면 안내로 처리한다. `EXPO_PUBLIC_` 환경 변수에는 장기 API 키나 백엔드 공유 비밀을 넣지 않는다.

지팡이·하차벨 준비 실패는 기기별 결과를 구분해 `assist_device_status_changed` 이벤트로 Realtime 세션에 전달한다. 노선 비콘 미등록·조회 실패는 지팡이 접근 진동 준비 실패로만 다루고 `attempted: false`로 기록한다. 이 경우에도 하차벨 BLE 연결은 별도로 계속 시도하며, 사용자 기기의 전원이나 하차벨 실패를 원인으로 단정하지 않는다. Realtime 연결이 없으면 같은 내용을 로컬 TTS로 안내한다.

BLE 스캔은 하나씩 실행하며, 지팡이 연결 요청이 들어오면 진행 중인 하차벨 시도는 스캔을 반납하고 네이티브 연결 취소·늦은 완료 정리를 수행한다. 같은 하차벨의 중복 요청은 정리가 끝날 때까지 기존 요청을 공유하지만 지팡이는 이를 기다리지 않는다. 하차벨 연결은 운행 ID와 대상 보드 이름으로 소유자를 기록하고, 실제 운행 취소·교체 시 해당 장치만 제한 재시도로 해제한다. 정상적인 하차 화면 이동은 해제 조건이 아니며, 동일 보드에 대한 새 연결만 이전 해제 완료를 기다린다. 하차벨 연결 실패 안내는 공통 `notifyFailure`를 통해 Realtime 이벤트 또는 공식 로컬 TTS fallback으로 전달한다.


## 리허설 수명주기 보완 (2026-09-22)

### 한 정거장 전 안내와 하차 화면 전환

탑승 확정된 활성 버스 운행에서 `remainingStations=1`, `bellStatus=PENDING`, 서버의 `bellRequestId`와 `STOP_REQUEST`가 확인되면 Riding 화면에서 한 정거장 전 안내를 한 번 시작한다. 이후 PATCH의 `shouldTriggerBell=false`는 이미 생성한 요청을 취소하지 않는다. 같은 `tripId`와 `bellRequestId`의 안내가 진행되는 동안 화면을 유지하며 BLE STOP 명령은 보내지 않는다.

Realtime 안내는 전용 응답의 `metadata.completionKey`로 `response.created`의 응답 ID를 연결한다. 같은 ID의 성공한 `response.done`, `output_audio_buffer.started`, `output_audio_buffer.stopped`가 모두 확인된 뒤에만 정상 재생 완료로 처리한다. 다른 응답의 종료, 생성 완료만 도착한 경우, `output_audio_buffer.cleared`는 재생 완료가 아니다. 이 이벤트는 WebRTC 서버 출력 버퍼 종료 신호이며 실제 기기 스피커 재생은 실기기에서 별도 확인한다.

Realtime 요청은 재생 시작까지 8초를 기다린다. 해당 응답의 출력 시작이 확인되면 이 제한을 해제하고, 재생 시작부터 60초의 별도 복구 제한을 둔다. 8초를 넘는 정상 음성을 실패로 판단하지 않는다. 같은 응답의 생성 완료와 출력 종료가 모두 있어야 정상 완료이며, 60초 제한은 이벤트 누락에 대한 실패 복구용이다. 연결 해제·응답 실패·제한 초과로 대체가 필요하면 기존 출력의 WebRTC 연결을 닫은 뒤 로컬 TTS를 시작한다. 실패 복구로 연결이 닫힌 경우 Realtime 대화를 다시 사용하려면 재연결이 필요하다. 출력 정리에 실패하면 대체 음성도 억제한다.

로컬 TTS는 `onDone`으로 정상 완료하며, 재생 요청부터 60초 동안 종료 콜백이 없으면 실패 복구를 시작한다. 오류·동기 예외·제한 초과에서는 비동기 `Speech.stop()`을 기다린다. 중지는 회당 최대 1.5초이며 명시적인 오류에 한해서 한 번 재시도한다. 응답하지 않는 중지 요청은 나중에 새 음성을 끊을 수 있으므로 추적을 유지한다. 요청이 아직 끝나지 않았다면 복구 버튼을 눌러도 새로운 중지나 음성을 실행하지 않는다. 늦은 완료만으로 억제를 해제하지 않고, 명시적인 복구에서 이전 요청이 끝난 뒤 새 중지 성공을 확인해야 한다. 타이머는 성공 추정에 사용하지 않는다. 운행 종료·취소·교체·화면 이탈 및 환승 여정 세대·구간·단계 변경은 오래된 콜백의 화면 전환을 막는다. GPS 완료와 환승 하차 확인 흐름이 우선한다.

### 음성 정리 및 연결 복구

`safe-speech.ts`가 한 정거장 전 안내, Riding·Alight·Transfer·Error 화면과 Provider의 모든 로컬 TTS 호출에 공통 출력 억제를 적용한다. 운행·화면 변경만으로 억제를 해제하지 않는다. 출력 정리에 실패한 Realtime 연결도 복구를 위해 보존한다. 중지 실패는 안내 실패로 표시하고 화면 이동·BLE 처리·운행 추적은 계속한다.

운행·하차·환승 화면에서 접근 가능한 “음성 복구” 버튼으로 앱 재시작 없이 복구할 수 있다. 기존 출력 연결의 정리와 로컬 음성 중지를 확인한 뒤 Realtime 연결을 한 번 시도한다. 음성을 재생 중일 수 있어 자동 재연결은 하지 않는다. 중복 요청은 진행 중 Promise를 공유한다. 연결에는 기존 20초 제한을 적용하고 화면 이탈·운행 종료/교체·환승 구간 변경·Provider 종료 시 취소하며 늦은 연결은 폐기한다. 실패하면 버튼으로 다시 시도할 수 있지만 자동 반복은 없다. 네이티브 중지가 영구히 응답하지 않는 기기 상태에서는 안전한 정리를 확인할 수 없으므로 억제를 유지하며 BLE와 화면 조작은 가능하다.

복구 중에는 새 로컬 안내를 억제하고, 정상 복구 연결은 시작 인사를 생성하지 않고 현재 운행·환승 사실만 주입한다. 복구 중 억제된 서버 확정 하차벨 결과와 현재 환승 구간 안내는 복구 후 현재 화면에서 한 번 다시 제공한다. 운행·화면이 바뀐 이전 안내는 재생하지 않는다. 음성 정리는 성공했지만 Realtime 재연결이 실패한 경우에도 로컬 안내는 재개할 수 있다. 처음 연결의 시작 안내는 기존 흐름을 유지한다.

안내 문구는 “하차 정류장까지 한 정거장 남았습니다. 안전하게 내릴 준비를 해주세요.”다. 서버의 PENDING은 요청 생성이며 실제 BLE 전송 완료가 아니므로 “하차벨을 요청했습니다”라고 선행 안내하지 않는다. 하차 화면 진입 후에만 기존 연결·전송·결과 저장을 실행한다. BLE 재시도 정책과 공개 API·DB 계약은 바꾸지 않는다.

- `RealtimeProvider`의 `trip-tracking.ts`가 운행별 GPS 구독과 도착 조회를 소유한다. `Riding`에서 `Alight`로 이동해도 GPS PATCH가 계속된다. 늦게 생성된 구독은 제거하고, 이전 운행/이미 탑승한 상태/완료보다 오래된 응답은 적용하지 않는다. 위치 requestId는 화면을 넘어 증가하는 순번을 포함한다. 좌표·전체 오류 객체를 로그에 출력하지 않는다.
- `TRIP_DONE`은 목적지 정류장 도착이며 실제 하차 감지를 뜻하지 않는다. 위치 전송을 중지하고 “목적지 정류장에 도착했습니다. 안전하게 내리세요. 안내를 마칩니다.”를 한 번 안내한다. 완료 응답의 생성과 WebRTC 출력 버퍼 종료가 모두 확인된 뒤 상태를 초기화하고 Main으로 이동한다. Realtime은 최대 20초, 로컬 `expo-speech` 대체는 최대 15초의 종료 제한을 둔다. 화면에는 같은 완료 문구를 표시한다. 운행 변경은 이전 완료 음성과 타이머를 취소한다.
- `TRIP_DONE` 이후 새 하차벨 연결·재시도·`STOP_REQUEST` 전송을 시작하지 않는다. 아직 물리 전송을 시작하지 않은 요청은 실패 결과를 저장하지 않고 취소한다. 이미 시작한 전송의 실제 Notify와 결과 저장은 계속 처리한다.
- Alight의 홈 버튼은 기존 `trips.end(..., { action: 'CANCEL' })` 성공 후에만 초기화한다. 실패하면 상태를 보존하고 다시 시도할 수 있게 표시한다. 벨 결과 저장은 최대 3회 재시도하되 물리 `STOP_REQUEST`를 추가로 보내지 않는다. 완료보다 늦은 저장 응답은 상태를 되돌리거나 벨 성공 음성을 내지 않는다.
- 실제 자동 탑승 연결은 `subscribeCaneState → createBoardingDetector → AUTO_DETECTED 확인 API`다. 현재 `WAITING_BUS` 운행과 설정 타깃의 새 유효 RSSI만 사용한다. BLE 어댑터는 구독 타깃·수신 시각·표본 순번을 붙이고, 해제된 구독 callback은 무시한다. 동일/역순/4초보다 낡은 표본과 NaN을 거절하며 기존 -60dBm·7초 임계값은 유지한다. 서버 성공만 앱에 반영하며 실패는 같은 requestId로 최대 3회(1초/2초 대기) 후 수동 확인을 안내한다. 취소·수동 확정·새 운행은 구독과 감지 창을 초기화한다. 기존 Notify에는 송신 측 표본 ID가 없으므로 펌웨어의 새 RSSI 송신 보장을 함께 사용한다.
- 지팡이 연결은 최대 3회(1초/2초 대기)다. 탑승·취소·운행 변경 뒤 추가 연결/START를 진행하지 않고 늦은 연결은 소유 운행의 정리 순서에 합류한다. STOP 성공 뒤에만 disconnect하며, 실패한 연결 참조는 다음 STOP/해제 시도에 사용할 수 있게 보존한다. 이전 소유자의 해제가 실패하면 새 타깃/START로 덮어쓰지 않는다. 보조기기 실패 안내는 실제 `attempts`와 `attempted`, `retryable`을 따른다.
- 지팡이 JSON Notify가 기본 ATT MTU 23의 payload를 넘으므로 앱은 `Device.requestMTU(185)` 결과의 `mtu >= 64`를 확인한 뒤 서비스 탐색과 명령을 진행한다. 펌웨어도 `BLEDevice::setMTU(185)`로 로컬 최대치를 설정하고, 협상된 payload보다 큰 Notify는 보내지 않는다. 앱 협상 실패/부족 MTU는 연결 실패로 처리한다. UUID·명령·Notify JSON 필드는 변경하지 않았다.

위 동작은 로컬 자동 시험과 타입 검사 대상으로 구현했다. 실제 휴대폰 GPS, WebRTC 스피커 출력, 지팡이 MTU·Notify, 실차 자동 탑승의 성공을 의미하지 않는다.

직행 탑승 대기 중 버스를 놓친 경우 서버 종료 성공 후 기존 검색을 유지하고 유효한 후보가 있으면 노선 선택 화면, 없거나 기존 5분 유효시간이 지났으면 메인 화면으로 복귀한다. 화면 포커스 확인 뒤 Realtime이 제공된 대체 후보를 다시 안내하며, 만료/빈 후보는 재검색을 요청한다. 화면 확인은 최대 5초만 기다리고 실패 또는 운행 교체 시 이전 후보 응답 생성을 생략한다. 종료 실패는 운행 상태를 유지한다. 단순 도착시간 질문과 명시적인 최신 도착정보 재조회는 기존 get_trip_status 흐름을 사용한다.
