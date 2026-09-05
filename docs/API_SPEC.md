# 공통 API 및 Function Calling 명세

> 문서 상태: 최종 계약. 데이터 모델·상태 전이는 [DB_SCHEMA.md](DB_SCHEMA.md)가 단일 출처다.

## 공통 규칙

- 공개 JSON과 Function 인수는 `camelCase`, DB 컬럼은 `snake_case`를 사용한다.
- 성공·실패 응답에는 `success`, `message`, `timestamp`를 사용하며 실패에는 `errorCode`를 포함한다.
- 모델은 `tripId`, `requestId`, `bellRequestId`, 현재 좌표, 서버가 계산하는 상태값을 임의 생성하지 않는다.
- Function 결과와 REST API 오류는 Dispatcher가 원문 구조를 보존해 Realtime 세션에 돌려준다.

## Realtime Function

| Function | REST API | 책임 |
| --- | --- | --- |
| `search_routes` | `POST /api/routes/search` | 목적지와 위치로 후보 경로 조회 |
| `create_trip` | `POST /api/trips` | 사용자가 선택한 후보로 운행 생성 |
| `confirm_boarding` | `POST /api/trips/{tripId}/boarding/confirm` | 사용자의 명시적 탑승 발화를 `USER_CONFIRMED`로 저장 |
| `get_trip_status` | `GET /api/trips/{tripId}/status` | 운행 상태 조회 및 선택 노선 도착정보 재조회 |
| `end_trip` | `PATCH /api/trips/{tripId}` | 명시적 사용자 취소·종료 처리 |

Function은 사용자 의도를 처리하는 경로다. 자동 GPS·하차벨 처리는 아래 REST API를 앱이 직접 호출하고, 변화가 있을 때 Event Dispatcher가 세션에 알린다.

## REST API

| Method | Path | 상태 변경 |
| --- | --- | --- |
| `POST` | `/api/routes/search` | 없음 |
| `POST` | `/api/trips` | 운행과 초기 상태 생성 |
| `POST` | `/api/trips/{tripId}/boarding/confirm` | 탑승 근거 원자 저장 및 현재 탑승 상태(`ON_BUS | NEAR_DESTINATION`) 반환 |
| `GET` | `/api/trips/{tripId}/status` | 없음 |
| `PATCH` | `/api/trips/{tripId}` | 사용자 취소 또는 종료 |
| `PATCH` | `/api/trips/{tripId}/status` | 위치 반영, 운행 상태·하차벨 판단 |
| `POST` | `/api/trips/{tripId}/bell/result` | 하차벨 결과 기록 |
| `GET` | `/api/beacons?routeNo=` | 없음 |
| `GET` | `/api/health` | 없음 |
| `POST` | `/api/realtime/session` | Realtime용 단기 키 발급 |

### `GET /api/trips/{tripId}/status`

기본 운행 상태를 반환하면서, `tripStatus`가 `WAITING_BUS`일 때 GBIS 도착정보를 선택 노선
기준으로 조회한다. 이 API는 DB의 운행·하차벨 상태를 변경하지 않는다.

생성 시 DB에 저장한 `predictedArrivalMinutes`나 앱·모델이 보관한 이전 안내값을 직접
재사용하지 않고, 서버의 `ArrivalCache`를 통해 선택 노선의 도착정보 스냅샷을 반환한다.

캐시 갱신 시점 전에는 서버가 보관한 스냅샷을 재사용하며, 갱신 시점 이후에만 GBIS를 다시
호출한다. 금지되는 것은 앱·모델이 과거 안내값을 자체적으로 재사용하는 것이지, 서버 정책에
따른 캐시 재사용이 아니다.

탑승이 확정된 뒤에는 이 값을 쓸 곳이 없으므로 조회하지 않는다. 상태와 무관하게 매번
조회하면 운행 내내 GBIS 호출이 이어진다.

**Query parameter**

| 이름 | 값 | 의미 |
| --- | --- | --- |
| `refreshArrivals` | `true` | 서버가 정한 갱신 주기 전이라도 GBIS를 다시 조회한다 |

`refreshArrivals=true`는 "버스 놓쳤어요"처럼 사용자가 최신 값을 명시적으로 요구한 경우에만
붙인다. "몇 분 남았어요?" 같은 일반 조회에는 붙이지 않는다 — 서버가 정한 주기를 앱이
우회하게 된다. 붙이더라도 서버는 마지막 GBIS 호출로부터 최소 간격(20초)은 그대로 지키므로,
발화가 여러 번 인식돼도 호출량이 늘지 않는다.

성공 응답에는 다음 필드가 추가된다(모두 `WAITING_BUS`일 때만).

```json
{
  "arrivals": [
    {
      "predictedArrivalMinutes": 4,
      "occupancy": {
        "type": "UNAVAILABLE",
        "congestionLevel": null,
        "remainingSeats": null
      }
    }
  ],
  "arrivalStatus": "AVAILABLE",
  "nextArrivalRefreshInMs": 60000,
  "shouldScanBeacon": true
}
```

`nextArrivalRefreshInMs`는 앱이 다음 조회까지 기다릴 시간(ms)이다. 주기를 앱이 스스로
정하면 서버의 호출 정책과 어긋나므로 서버가 남은 시간에 맞춰 정한다. 값이 없으면 앱은
반복 조회를 하지 않는다.

| 남은 시간 | 주기 |
| --- | --- |
| 4분 이하 | 30초 |
| 5분 이하 | 1분 |
| 그보다 멀면 | 남은 시간의 절반, 최대 5분 |

`shouldScanBeacon`은 스마트지팡이 비콘 스캔을 시작해야 하는지다. 도착 5분 이내이거나
도착정보를 확인하지 못한 경우(`NO_PREDICTION`·`UPSTREAM_ERROR`) 참이다. `NO_VEHICLE`은
조회에 성공했고 오는 차가 없다는 확인된 사실이므로 거짓이다. 한 번 켠 스캔을 끄지 않는 것은
앱 책임이다 — 앞차가 떠나면 도착 예정 시간이 다시 늘어나는데, 그때 끄면 정작 버스가 눈앞에
왔을 때 스캔이 꺼져 있다.

`arrivalStatus`는 도착정보 재조회 결과를 구분한다.

| 값 | 의미 | `arrivals` |
| --- | --- | --- |
| `AVAILABLE` | 정상 조회되었고 선택 노선 차량이 있음 | 1~2개 |
| `NO_VEHICLE` | 정상 조회되었지만 선택 노선 레코드가 없음 | `[]` |
| `NO_PREDICTION` | 레코드는 있으나 예상 도착 시간이 비어 있음 | `[]` |
| `UPSTREAM_ERROR` | GBIS 네트워크·HTTP·응답 오류, 또는 방향을 확인하지 못해 조회 결과를 신뢰할 수 없음 | `[]` |

`NO_VEHICLE`은 GBIS가 정상 응답했고 그 정류장에 해당 노선 차량이 실제로 없을 때만
쓴다. 회차 노선의 방향 판별에 필요한 노선 경유정류소 조회가 실패하거나 목적지 기준
방향을 확정하지 못하면, 잘못된 방향 안내를 막기 위해 `arrivals`를 비우되
`UPSTREAM_ERROR`로 보고한다. 두 경우를 합치면 "확인하지 못했다"가 "그 버스는 이제
오지 않는다"로 안내된다.

`UPSTREAM_ERROR`에서도 운행 상태는 취소·종료되지 않는다. 사용자는 새 Function
호출 결과만 근거로 안내받으며, 조회 전의 도착 예정 시간을 반복해서 안내하지 않는다.

`NO_PREDICTION`은 `NO_VEHICLE`과 합치지 않는다. GBIS 공식 문서에서 빈 `predictTime`이
"차량 없음"을 뜻한다고 확인한 적이 없고 실제 캡처에도 두 순번이 모두 빈 사례가 없다.
확인된 사실은 "도착시간 정보가 없다"까지이므로 "오는 버스가 없습니다"라고 안내하면 안 된다.

재조회 결과는 DB에 다시 저장하지 않는다. `trips.predicted_arrival_minutes`에는
`POST /api/trips`의 최초 도착시간만 남고, 이후 갱신값은 서버 프로세스의 도착정보 캐시와
앱 상태·Realtime 전달값에만 존재한다. 대기 중 앱은 `nextArrivalRefreshInMs` 주기로 이
엔드포인트를 반복 호출하며, `refreshArrivals=true`는 놓침 발화에만 붙인다.

`arrivals`, `arrivalStatus`, `nextArrivalRefreshInMs`, `shouldScanBeacon`은 이 GET 응답의
`WAITING_BUS` 상태에만 있다. 넷 다 같은 조건으로 실리고 빠진다 — 하나만 남겨 두면
"왜 이건 오고 저건 안 오는지"로 계약이 헷갈린다. `PATCH /api/trips/{tripId}/status` 응답에는 포함되지 않으므로
공유 스키마에서 네 필드 모두 선택 필드다.

### `POST /api/routes/search`

검색 결과는 기존 순위·중복 제거 규칙을 적용한 뒤 상위 5개까지 `routes[]`에 담는다. 응답 배열은 순위 순서를 유지하며, `guideMessage`는 상위 2개 후보에만 포함한다. 3위 이후 후보에는 이 필드를 생략한다.

경로 검색 provider는 검색 1회당 한 번만 호출하고, 사용자가 다음 후보를 요청할 때는 앱이 이미 받은 `routes[]`를 재사용한다. 도착정보는 사용자가 후보를 선택한 뒤 `POST /api/trips`에서 최초 조회하고, 버스를 놓친 뒤 `get_trip_status`가 호출되면 `GET /api/trips/{tripId}/status`에서 선택 노선을 기준으로 새로 조회한다.

## Health 상태 조회

`GET /api/health`는 요청 query/body를 사용하지 않고 서버와 Supabase 연결 상태를 확인한다. 공개 응답은 `packages/shared`의 health Schema를 단일 계약으로 사용하며 `timestamp`는 ISO 8601 문자열이다.

| Supabase 상태 | HTTP | `success` | `serverStatus` | `dbStatus` | `errorCode` |
| --- | ---: | --- | --- | --- | --- |
| 연결 성공 | 200 | `true` | `UP` | `UP` | 없음 |
| 환경변수 미설정 | 200 | `true` | `UP` | `NOT_CONFIGURED` | 없음 |
| 연결 실패 | 500 | `false` | `UP` | `DOWN` | `DB_ERROR` |

성공 응답은 `success: true`, `serverStatus: "UP"`, `dbStatus: "UP" | "NOT_CONFIGURED"`, `message`, `timestamp`를 포함한다. 장애 응답은 `success: false`, `serverStatus: "UP"`, `dbStatus: "DOWN"`, `errorCode: "DB_ERROR"`, `message`, `timestamp`를 포함한다. 이 조합과 다른 모순된 상태 조합은 shared Schema에서 허용하지 않는다.

## 운행 생성 도착 정보

`POST /api/trips` 성공 응답은 도착 예정 차량을 **`arrivals` 배열**로 반환한다. 도착 순서대로 최대 2대이며, GBIS가 1대만 주면 1개, 정보가 없거나 조회에 실패하면 빈 배열 `[]`이다. **조회 실패는 운행 생성을 막지 않는다** — `arrivals: []`로 `201`을 반환한다. GBIS 호출 timeout은 5초다.

```json
{
  "arrivals": [
    { "predictedArrivalMinutes": 6,  "occupancy": { "type": "CONGESTION",      "congestionLevel": 3,    "remainingSeats": null } },
    { "predictedArrivalMinutes": 21, "occupancy": { "type": "REMAINING_SEATS", "congestionLevel": null, "remainingSeats": 4 } }
  ]
}
```

| `occupancy.type` | `congestionLevel` | `remainingSeats` |
| --- | --- | --- |
| `CONGESTION` | `1`~`4` (1 여유 / 2 보통 / 3 혼잡 / 4 매우혼잡) | `null` |
| `REMAINING_SEATS` | `null` | `0` 이상 정수. **`0`은 "정보 없음"이 아니라 "만석"이다** |
| `UNAVAILABLE` | `null` | `null` |

도착 시간이 없는 차량은 배열에 넣지 않으므로 `arrivals[].predictedArrivalMinutes`는 nullable이 아니다. 계약은 `packages/shared`의 `ArrivalInfoSchema`·`OccupancySchema`를 단일 출처로 사용하며, `type`과 값의 정합성은 Schema가 강제한다.

### GBIS 원본 → 공개 계약 변환

**노선유형(`routeTypeCd`)이 어느 필드가 유효한지 결정한다.** 한 차량이 혼잡도와 잔여좌석을 모두 주고 그중 하나를 고르는 구조가 아니다. GBIS 원본 값은 그대로 공개 응답에 싣지 않는다.

| 원본 필드 | 유효 노선유형 | 판정 |
| --- | --- | --- |
| `crowded1/2` | `13` 일반형시내 · `15` 따복형시내 · `23` 일반형농어촌 | `1`~`4`만 유효, 그 외(`""`·`0`·범위 밖)는 정보 없음 |
| `remainSeatCnt1/2` | `11` · `12` · `14` · `16` · `17` · `21` · `22` (좌석형 계열) | **`-1`만 정보 없음.** `0` 이상은 전부 실제 좌석 수 |

대상이 아닌 필드는 값이 무엇이든 읽지 않는다. 해당 노선유형인데 유효값이 없거나(예: 좌석형인데 `remainSeatCnt = -1`) 두 집합 어디에도 속하지 않는 노선유형(마을버스 `30` 등)이면 `UNAVAILABLE`이다.

> 일반형시내버스 응답에도 `remainSeatCnt = 0`이 실려 오지만 그 노선유형은 이 필드의 대상이 아니다. 노선유형을 보지 않고 값만으로 판정하면 **여유로운 시내버스를 만석으로 안내**하거나, 반대로 **실제 만석인 좌석형 버스의 `0`을 정보 없음으로 잘못 접는다.** 근거는 GBIS 공유서비스 「버스 도착정보 항목조회」 매뉴얼이다.

## 비콘 조회

`GET /api/beacons?routeNo=`은 노선별 ESP32 비콘 식별자를 반환한다. 응답 계약은 `packages/shared`의 beacon Schema를 단일 출처로 사용한다.

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `routeNo` | string | 요청한 노선 번호 |
| `targetBeaconId` | string | 앱이 스마트지팡이에 `SET_TARGET_BEACON`으로 넘기는 값. **ESP32가 BLE로 광고하는 device name과 정확히 같아야 한다** |
| `isMock` | boolean | 실물 비콘이면 `false`, mock이면 `true` |

`targetBeaconId` 형식은 두 가지다. 값 자체에 대한 형식 검증은 하지 않으므로(`z.string()`), 아래는 운영 규칙이다.

| 종류 | 형식 | `isMock` |
| --- | --- | --- |
| 실물 ESP32 | `BUS_{routeToken}_{vehicleToken}` (예: `BUS_1551_001`) | `false` |
| mock | `MOCK_BUS_{routeToken}_{vehicleToken}` (예: `MOCK_BUS_7002_001`) | `true` |

> `targetBeaconId`가 펌웨어의 광고 이름과 어긋나면 지팡이가 존재하지 않는 이름을 스캔해 **탑승 안내 진동이 아예 울리지 않는다.** 값은 예외도 오류도 내지 않으므로 로그에 드러나지 않는다. 펌웨어 `DEVICE_NAME`을 바꾸면 `bus_beacons.target_beacon_id`와 `packages/shared/src/fixtures/demo-beacon.ts`를 같은 변경 단위에서 함께 맞춘다.
>
> 시연 노선 `1551`은 2026-08-14부터 실물 비콘(`BUS_1551_001`, `isMock: false`)이다.

`isMock`은 서버 로직 분기에 쓰이지 않고 응답 필드로만 나간다. 앱은 이 값과 실제 BLE 연결 성공 여부를 함께 보고 `POST /api/trips/{tripId}/bell/result`의 `isMock`을 정한다.

상태 코드는 `200`(조회 성공) · `400`(`routeNo` 누락) · `404`(`BEACON_NOT_FOUND`) · `500`(`DB_ERROR`)이다.

## Realtime 세션

`POST /api/realtime/session`은 백엔드가 OpenAI `POST /v1/realtime/client_secrets`를 호출해 단기 키를 반환하는 계약이다. 요청에는 `session.model`과 `expires_after`만 전달하고, `instructions`와 `tools`는 WebRTC 연결 후 앱이 설정한다. 장기 OpenAI API 키는 앱 번들에 포함하지 않고, 공유 비밀은 `EXPO_PUBLIC_`로 노출하지 않는다.

### `POST /api/realtime/session`

앱이 OpenAI Realtime WebRTC 연결 직전에 호출하는 서버 API다. 서버는 `OPENAI_API_KEY`로 OpenAI 단기 키를 발급하고, 앱은 반환된 `clientSecret`만 OpenAI WebRTC 연결에 사용한다.

#### 요청

| 항목 | 위치 | 필수 | 설명 |
| --- | --- | --- | --- |
| `x-realtime-shared-secret` | Header | 예 | 서버 `REALTIME_SHARED_SECRET`과 동일해야 하는 내부 인증 값 |

요청 body는 사용하지 않는다.

#### 성공 응답

```json
{
  "success": true,
  "clientSecret": "ek_...",
  "model": "gpt-realtime-mini",
  "expiresAt": "2026-08-01T12:10:00.000Z",
  "message": "Realtime 세션 키를 발급했습니다.",
  "timestamp": "2026-08-01T12:00:00.000Z"
}
```

#### 실패 응답

| HTTP | `errorCode` | 조건 |
| --- | --- | --- |
| `401` | `UNAUTHORIZED` | 요청 헤더의 공유 비밀이 없거나 서버 값과 다름 |
| `401` | `UNAUTHORIZED` | 서버 `REALTIME_SHARED_SECRET`이 설정되지 않음 |
| `502` | `REALTIME_SESSION_FAILED` | 서버 `OPENAI_API_KEY`가 설정되지 않음 |
| `502` | `REALTIME_SESSION_FAILED` | OpenAI 호출 실패, 비2xx 응답 또는 응답 형식 오류 |

`REALTIME_SHARED_SECRET`은 비어 있으면 안 된다. 값이 없더라도 세션 발급 API를 인증 없이 열지 않고, 요청 헤더 불일치와 동일하게 `401 UNAUTHORIZED`로 거부한다. 모든 오류 응답은 `success`, `errorCode`, `message`, `timestamp`를 포함하며 장기·단기 키나 서버 설정 상세를 오류 메시지에 넣지 않는다.

### Realtime WebRTC 연결

앱은 `/api/realtime/session`에서 받은 `clientSecret`을 Bearer 토큰으로 사용해 OpenAI Realtime WebRTC에 연결한다. ephemeral key 방식에서는 SDP offer 원문을 `Content-Type: application/sdp` body로 전송하고, SDP answer를 받아 `RTCPeerConnection`에 설정한다. WebRTC 연결 이후 앱이 `instructions`와 Function schema를 세션에 등록한다.

## 상태·하차벨 계약

### `POST /api/trips/{tripId}/boarding/confirm`

명시적 사용자 발화와 프론트 BLE 자동 판정이 공유하는 단일 탑승확정 API다. 두 경로 모두 서버 저장 성공 응답을 받은 뒤에만 앱 상태를 바꾼다.

```json
{ "requestId": "boarding-voice-001", "boardingMethod": "USER_CONFIRMED" }
```

```json
{
  "requestId": "boarding-ble-001",
  "boardingMethod": "AUTO_DETECTED",
  "detectedAt": "2026-08-22T01:00:00.000Z"
}
```

- `USER_CONFIRMED`: 사용자가 “버스 탔어요”, “버스 탔어”, “지금 탔습니다”처럼 실제 탑승을 명시하면 충분한 근거다. BLE·GPS 재확인이나 중복 질문 없이 즉시 호출하며 `detectedAt`을 보내지 않는다.
- `AUTO_DETECTED`: BLE 원시 신호 수집과 최종 자동 판정 알고리즘은 프론트 BLE 모듈 책임이다. 판정이 완료되면 같은 API를 호출하며 `detectedAt`은 선택 ISO 8601 값이다. 서버 확정 시각보다 미래인 값은 `400 INVALID_REQUEST`다.
- `requestId`는 탑승확정 전용 멱등 키다. 위치 업데이트의 `location_logs.request_id`와 공유하지 않는다.
- `boardingConfirmedAt`은 클라이언트가 보내지 않으며 서버가 생성한다. 동시 호출은 DB 최초 기록자가 승리하고 이후 요청은 저장된 최초 `boardingMethod`와 시각을 반환한다.

성공 응답은 `tripId`, 현재 `tripStatus`(`ON_BUS | NEAR_DESTINATION`), `boardingMethod`, `boardingConfirmedAt`, `message`, `timestamp`를 반환한다.

| HTTP | `errorCode` | 조건 |
| ---: | --- | --- |
| 400 | `INVALID_REQUEST` | body 형식 오류, 허용되지 않은 조합, 미래 `detectedAt` |
| 404 | `TRIP_NOT_FOUND` | 운행 없음 |
| 409 | `INVALID_TRIP_STATUS` | 완료·취소 등 확정 불가 상태 |
| 409 | `BOARDING_STATE_INCONSISTENT` | 상태와 탑승 메타데이터가 서로 모순됨 |
| 500 | `DB_ERROR` | 원자 저장 또는 저장 결과 조회 실패 |

- `PATCH /status`는 위치를 반영한다. 탑승확정 전에는 정류장 진행과 위치 로그만 저장하고 `tripStatus: WAITING_BUS`, `shouldTriggerBell: false`를 유지한다. 첫 GPS만으로 `ON_BUS`가 되지 않는다. 탑승확정과 경쟁한 stale `WAITING_BUS` 위치 요청은 DB가 저장하거나 `requestId`를 소비하지 않고 내부 재시도 결과를 반환한다. 서버는 최신 확정 상태를 다시 읽어 같은 위치를 한 번만 재계산하므로 `remainingStations = 1`의 하차벨과 `0`의 운행 완료를 놓치지 않는다.
- 탑승확정 뒤의 `PATCH /status`만 `ON_BUS`, `NEAR_DESTINATION`, `TRIP_DONE`과 하차벨 여부를 계산한다. `GET /status`는 조회 전용이며 항상 `shouldTriggerBell: false`, `command: null`을 반환한다.
- 서버는 직전 위치의 `recordedAt` 또는 좌표가 마지막으로 변경된 시각으로부터 60초를 초과하면 위치 업데이트 지연으로 판단한다. 앱이 다시 요청을 보낸 첫 응답에만 `locationStatus: "STALE"`, `locationGapSeconds`, `locationWarning`을 포함한다.
- 위치 공백 뒤 현재 정류장보다 두 정류장 이상 앞선 좌표가 들어오면 실제 가장 가까운 이후 정류장까지 진행을 복구한다. 정상 업데이트의 다중 정류장 점프는 한 정류장으로 제한한다.
- 정류장 거리 비교는 Haversine 거리 기준으로 계산한다.
- `remainingStations = 2`는 사전 안내만 하며 하차벨을 만들지 않는다.
- `boardingConfirmedAt`이 존재하고 `remainingStations = 1`, `bellStatus = NOT_REQUESTED`일 때만 DB 원자 전이의 승자가 `bellRequestId`, `command: "STOP_REQUEST"`, `shouldTriggerBell: true`를 반환하고 `bellStatus`를 `PENDING`으로 바꾼다. 같은 스냅샷에서 계산된 동시 GPS 요청의 패자는 최신 `PENDING` 상태와 `shouldTriggerBell: false`를 반환한다.
- `POST /bell/result`는 `PENDING`인 동일 `bellRequestId` 결과만 기록한다. 다른 상태는 `409 INVALID_BELL_STATE`다.
- 종료 운행(`CANCELLED`, `TRIP_DONE`)은 새 `requestId`의 `PATCH /status`를 `409 INVALID_TRIP_STATUS`로 거부한다. 이미 처리한 동일 `requestId` 재전송은 종료 상태보다 먼저 멱등 처리해 `200`을 반환한다.

## 구현 및 변경 관리

API 경로·필드·enum 변경 시 `packages/shared`, 서버, 앱 Dispatcher, 테스트, 이 문서와 Notion 공통 명세를 같은 변경 단위로 동기화한다. 코드와 계약이 다르면 실제 코드 동작과 목표 계약을 분리해 PR에 남긴다.
