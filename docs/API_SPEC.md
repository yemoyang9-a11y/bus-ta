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