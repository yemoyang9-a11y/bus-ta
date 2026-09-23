# 모듈 계약과 책임 경계

> 문서 상태: 최종 개발 기준. API 형식은 [API_SPEC.md](API_SPEC.md), 상태값은 [DB_SCHEMA.md](DB_SCHEMA.md)를 따른다.

## 책임 경계

| 모듈 | 담당 | 담당하지 않는 일 |
| --- | --- | --- |
| 앱·Function Dispatcher | 사용자 입력, Realtime 이벤트 수신, REST 변환, 서버 성공 응답의 앱 상태 반영 | 서버 응답 전 `ON_BUS` 확정 |
| 프론트 BLE | BLE 원시 신호 수집, 필터링, 자동 탑승 여부의 최종 알고리즘 판정, `AUTO_DETECTED` API 호출 | DB 상태 직접 변경, 하차벨 조기 생성 |
| GPT-Realtime mini | 의도 이해, 정의된 Function 선택, 결과 음성 안내 | `tripId`·좌표·상태 생성, 외부 API 직접 호출 |
| 백엔드 | 탑승 근거 원자 저장, 권위 상태 전환, 경로·도착정보·운행·하차벨·세션 키 처리 | BLE 원시 신호 수집·자동 판정 알고리즘, API 키를 앱에 전달 |
| `packages/shared` | 타입, enum, API 경로, Zod 검증의 공통 기준 | 서버와 앱이 별개 계약을 갖도록 방치 |
| 하드웨어 | 비콘·스마트지팡이·하차벨 동작과 결과 전달 | 공개 API가 확정되지 않은 감지 로그의 저장을 완료로 표시 |

## 경로와 도착정보

서버는 경로 검색에서 후보를 검증하고, 사용자가 선택한 후보 하나를 `POST /api/trips` 안에서 도착정보 조회에 사용한다. 후보에는 `candidateId`, `routeNo`, `localBusId`, `gbisStationId`, 정류장 목록과 좌표가 포함된다. 정류장 객체에 구버전 `stationId`, `routeDirection`, `endStationName`을 공개 계약으로 추가하지 않는다.

실제 경로 제공자는 기본 `DIRECT_BUS`이며 `ROUTE_SEARCH_SCOPE=MULTIMODAL`을 명시하면 버스 구간을 포함하는 환승·버스와 지하철 혼합 후보도 안내한다. 지하철 단독 후보는 제외한다. `ROUTE_SEARCH_MODE=MOCK`는 별도로 기존 시연 fixture 제공자를 선택하며, 제공자 선택은 요청 시점에 환경변수를 읽는다.

공개 후보의 `routeMode`는 `DIRECT_BUS | MULTIMODAL`, `tripSupported`는 운행 지원 여부, `segments`는 `WALK | BUS | SUBWAY` 순서다. ODsay 숫자형 `pathType`·`trafficType`은 어댑터 내부에서만 해석한다. 구버전 직행 응답과 호환하기 위해 새 필드는 선택 사항이나 실제 검색 어댑터는 항상 채운다. 다중교통에서는 `tripSupported=false`이며, 최상위 `localBusId`·`gbisStationId`·`boardingStation`·`destinationStation`·`stationList`는 첫 번째 버스 구간만 뜻한다. 최종 목적지와 전체 이동 순서 안내는 반드시 `segments`를 사용한다. 여러 버스 정류장 목록을 단일 추적 경로로 합치지 않는다.

앱의 화면 선택과 Realtime `create_trip` 모두 안내 전용 후보의 운행 생성을 차단해야 한다. 서버도 명시적으로 전달된 `tripSupported:false`, `routeMode:MULTIMODAL`, `busTransitCount>1`을 `400 INVALID_REQUEST`로 거부한다. 서버는 요청 정류장 목록 자체를 검사하며 저장된 검색 후보와 대조하지 않는다. 환승 메타데이터를 모두 제거한 임의 직행 모양 요청까지 검색 이력으로 인증한 것은 아니다. 환승 운행 추적·BLE·DB 필드 확장은 이번 범위에 없다.

대기 중에는 앱이 서버가 준 `nextArrivalRefreshInMs` 주기로 `GET /api/trips/{tripId}/status`를 반복 호출한다. 사용자가 버스를 놓쳤다고 말하면 Dispatcher가 `refreshArrivals=true`를 붙여 같은 엔드포인트를 호출한다. "몇 분 남았어요?" 같은 일반 질문에는 붙이지 않는다. 서버는 저장된 선택 노선 식별자로 `ArrivalCache`를 거쳐 GBIS를 조회하고 `arrivals`와 `arrivalStatus`를 반환한다. `AVAILABLE`, `NO_VEHICLE`, `NO_PREDICTION`, `UPSTREAM_ERROR` 네 값을 구분한다. 캐시는 실패 시 이전 배열을 보존할 수 있으나 `UPSTREAM_ERROR`에서는 이를 최신 도착시간으로 안내하지 않는다. 방향 판별에 실패해 fail-closed로 접은 결과는 `NO_VEHICLE`이 아니라 `UPSTREAM_ERROR`다. 이 조회는 운행·하차벨 상태를 변경하지 않는다.

재조회 결과는 DB에 다시 쓰지 않는다. `trips.predicted_arrival_minutes`에는 `POST /api/trips`의 최초 값만 남고, 이후 갱신값은 서버 프로세스의 `ArrivalCache`와 앱 상태·Realtime 전달값에만 존재한다. 안내에 필요한 것은 언제나 "지금 값"이라 이력을 저장할 이유가 없다.

`arrivals`, `arrivalStatus`, `nextArrivalRefreshInMs`, `shouldScanBeacon` 네 필드는 `GET /status`의 `WAITING_BUS` 응답에만 실린다. `PATCH /status` 응답에는 없으므로, 앱은 이 네 필드가 없는 응답을 받았다고 해서 직전 값을 지우지 않는다 — 대기 중이면 유지하고, 대기 상태를 벗어났으면 비운다. 탑승 전 `stopsAway`는 공개 계약에 없다. GBIS `locationNo1/2`를 올릴지는 별도 후속 작업이다.

## Realtime 연동

1. 백엔드는 단기 키만 발급한다.
2. 앱은 WebRTC 연결 뒤 instructions와 tools를 설정한다.
3. 모델의 Function 호출은 앱 Dispatcher가 REST 요청으로 변환한다.
4. GPS·하차벨 같은 자동 이벤트는 모델 호출을 기다리지 않고 앱이 API 처리 후 변화가 있을 때 세션에 주입한다. 도착정보 반복 조회 결과도 같은 경로로 주입하며, 주입 이벤트는 `arrivalStatus`와 `predictedArrivalMinutes`를 함께 싣는다. 다만 도착시간이 줄었다는 이유만으로는 안내를 만들지 않고, 첫 차량이 `AVAILABLE`이면서 2분 이내로 처음 들어온 경계에서만 만든다.
5. Realtime 세션의 대화 기억은 저장소가 아니다. `tripId`, 선택 후보 및 실제 운행 상태의 기준은 앱 상태와 백엔드 데이터다. 도착 예정 시간도 마찬가지로, 노선 선택 이후의 질문에는 `create_trip` 때 들었던 값이 아니라 그 시점의 `get_trip_status` 결과만 근거가 된다.
6. 사용자가 버스에 탔다고 명시하면 모델은 `confirm_boarding`을 호출한다. Dispatcher가 활성 `tripId`, 전용 `requestId`, `USER_CONFIRMED`를 채우며 BLE·GPS 재확인은 하지 않는다.
7. 서버 성공 전에는 AI와 앱 모두 탑승 완료로 안내·표시하지 않는다.
8. 탑승확정 응답의 `tripId`가 현재 활성 운행과 다르면 Dispatcher는 앱 상태에 반영하지 않고 stale 응답 오류로 처리한다.

## 하드웨어 연동

`GET /api/beacons?routeNo=`의 `targetBeaconId`는 스마트지팡이 대상 식별에 사용한다. 프론트 BLE는 수집한 신호로 자동 탑승을 최종 판정한 뒤 `AUTO_DETECTED`로 공통 탑승확정 API를 호출한다. 원시 RSSI를 백엔드에 저장하는 공개 계약은 만들지 않는다. 하차벨 명령은 탑승확정 이후 `PATCH /status` 응답의 `shouldTriggerBell`, `bellRequestId`, `command: STOP_REQUEST`를 사용할 때만 전송한다. 하차벨 보드의 BLE 연결도 탑승확정 이후에 시도한다(2026-09-04 확정). 정류장에서 대기하는 동안에는 버스가 아직 없어 연결이 반드시 실패하고, 그 실패를 그대로 두면 탑승 후에도 재시도되지 않는다. 연결 대상 이름은 `GET /api/beacons?routeNo=`의 `targetBeaconId`를 사용하며 앱에 고정하지 않는다. 제한 횟수까지 실패하면 사용자에게 기사님께 직접 말씀드리라고 안내한다.

## 변경 영향

공개 API, 공유 타입, enum, DB 컬럼, Function 입력을 바꾸면 영향을 받는 앱·서버·AI·하드웨어 소비자를 확인한다. API Path·메서드 변경은 Dispatcher 변환도, 상태 전이 변경은 shared 타입·DB 제약·응답 처리도 함께 갱신한다.
