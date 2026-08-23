# 공통 데이터 모델 및 상태 명세

> 문서 상태: 최종 계약이며 상태 전이의 단일 출처다. 실제 DB 적용 여부는 migration 파일만으로 판단하지 않고 Supabase 적용 기록 또는 조회로 확인한다.

## 기준과 구현 상태

현재 구현 사실은 `claude/nice-archimedes-iv7iu0`의 서버·`packages/shared`·현재 테스트를 기준으로 하며, 실제 DB 적용 여부는 저장소 migration 이력과 분리해 Supabase 적용 기록 또는 조회로 검증한다. 이 문서는 합의된 목표 계약이다. 둘이 다르면 어느 한쪽을 묵시적으로 고치지 않고 차이, 영향 소비자, 결정 및 검증 계획을 PR에 남긴다.

## 공통 식별자와 모델

| 모델 | 핵심 필드 |
| --- | --- |
| Station | `stationName`, `latitude`, `longitude`, `sequence` |
| Route candidate | `candidateId`, `routeNo`, `localBusId`, `gbisStationId`, `boardingStation`, `destinationStation`, `stationList` |
| Trip | `tripId`, 선택 후보 정보, `tripStatus`, `bellStatus`, `predictedArrivalMinutes` |
| Location update | `requestId`, `latitude`, `longitude`, `recordedAt`, `source` |
| Boarding confirmation | `boardingRequestId`, `boardingMethod`, `boardingDetectedAt`, `boardingConfirmedAt` |
| Bell result | `bellRequestId`, `result`, `message`, `isMock` |
| Beacon | `routeNo`, `localBusId`, `vehicleId`, `targetBeaconId`, `isMock` |

위치 `requestId`는 `tripId` 안에서 위치 업데이트 멱등 키이고, `boardingRequestId`는 탑승확정 전용 멱등 키이며 서로 공유하지 않는다. `bellRequestId`는 하차벨 요청과 결과를 잇는 키다. `recordedAt`은 ISO 8601 시간으로 전달한다. ODsay 내부 경로 유형 값은 공개 API·DB·공통 계약에 포함하지 않는다.

`candidateId`(공개 API)와 `candidate_id`(DB)는 필수 양의 정수(1 이상) 계약이다.

## Enum

```text
tripStatus: WAITING_BUS | ON_BUS | NEAR_DESTINATION | TRIP_DONE | CANCELLED
bellStatus: NOT_REQUESTED | PENDING | SUCCESS | FAIL
source: GPS | MOCK | MANUAL
command: STOP_REQUEST
boardingMethod: USER_CONFIRMED | AUTO_DETECTED
```

## 운행 상태 전이

```text
POST /trips → WAITING_BUS
POST /boarding/confirm (원자 저장 성공) → ON_BUS 또는 NEAR_DESTINATION
PATCH /status (탑승확정 전) → WAITING_BUS 유지 + 위치 로그 저장
PATCH /status (탑승확정 후 수락된 위치) → ON_BUS 또는 NEAR_DESTINATION 또는 TRIP_DONE
PATCH /trips (end_trip) → CANCELLED
```

- 종료 상태인 `CANCELLED`, `TRIP_DONE`에는 새 위치 업데이트를 반영하지 않는다.
- 같은 `tripId + requestId`는 최초 처리 결과를 재사용한다. 종료된 운행이라도 이미 처리한 `requestId`면 200을 반환하고, 새 키면 409을 반환한다.
- `WAITING_BUS`는 탑승 메타데이터가 없어야 한다. `ON_BUS`, `NEAR_DESTINATION`, `TRIP_DONE`은 `boarding_method`, `boarding_confirmed_at`, `boarding_request_id`가 모두 있어야 한다.
- 기존 활성 데이터를 자동으로 탑승확정했다고 보정하지 않는다. 마이그레이션은 기존 `ON_BUS`·`NEAR_DESTINATION` 행이 하나라도 있으면 중단되므로, 배포 전에 해당 운행을 정상 종료하거나 취소한 뒤 다시 적용한다.

## 하차벨 상태 전이

```text
NOT_REQUESTED --(탑승확정 + PATCH /status, remainingStations = 1)--> PENDING
PENDING --(POST /bell/result)--> SUCCESS | FAIL
```

- 하차벨 요청은 DB 행 잠금과 `NOT_REQUESTED → PENDING` compare-and-set으로 단 한 번 생성한다. 같은 스냅샷에서 계산된 동시 위치 요청도 승자만 `bell_logs`를 만들며, `PENDING`, `SUCCESS`, `FAIL`에서는 재생성하지 않는다.
- `remainingStations = 2`에서는 안내만 한다.
- 결과 저장은 `PENDING` 상태에서만 가능하며 그 밖의 요청은 `409 INVALID_BELL_STATE`다.

## DB 매핑 원칙

공개 API의 `tripId`, `candidateId`, `routeNo`, `localBusId`, `gbisStationId`, `requestId`, `bellRequestId`, `tripStatus`, `bellStatus`, `remainingStations`는 각각 같은 의미의 `snake_case` 컬럼으로 매핑한다. 위치 로그는 `UNIQUE(trip_id, request_id)` 제약을 권장하며, 제약 오류를 그대로 500으로 누출하지 않도록 멱등 처리 경로를 둔다.

## Data API와 DB 역할 권한 계약

`20260804112643_secure_data_api_access.sql`과 `20260805045657_restrict_future_data_api_access.sql` 적용 후의 목표 권한은 다음과 같다. migration 파일 작성과 원격 DB 적용은 별도 상태로 기록한다.

| 대상 | `public`·`anon`·`authenticated` | `service_role` | 추가 보호 |
| --- | --- | --- | --- |
| `trips`, `trip_status`, `location_logs`, `bell_logs`, `bus_beacons` | 테이블 권한 없음 | `SELECT`, `INSERT`, `UPDATE`, `DELETE` | RLS 활성화, 클라이언트 policy 없음 |
| `save_trip_status_and_location`, `confirm_trip_boarding`, `cancel_trip` RPC | `EXECUTE` 없음 | `EXECUTE` | `SECURITY INVOKER`, 빈 `search_path`, 스키마 한정 참조 |

`trip_status`의 탑승 컬럼은 `boarding_method`, `boarding_confirmed_at`, `boarding_request_id`, `boarding_detected_at`이다. `confirm_trip_boarding`이 이 값들과 상태를 한 트랜잭션에서 기록한다. `save_trip_status_and_location`은 `boarding_confirmed_at`이 없으면 요청 body가 `ON_BUS`나 하차벨을 요구해도 DB에서 `WAITING_BUS`로 고정하고 하차벨 로그를 만들지 않는다. 반대로 DB에는 탑승확정이 있지만 요청 body가 stale `WAITING_BUS`이면 위치 로그를 저장하지 않고 내부 결과 `BOARDING_CONFIRMED_RETRY`를 반환한다. 서버는 최신 행을 다시 읽어 동일 위치 요청을 최대 한 번 재계산한다.

탑승확정과 GPS 저장이 겹쳐 확정 전 스냅샷에서 계산된 `WAITING_BUS` payload가 늦게 도착하면, 위치·정류장 진행 정보는 저장하되 DB의 확정된 탑승 상태는 되돌리지 않는다. 백엔드는 저장 직후 이 권위 상태를 재조회해 같은 값을 앱에 반환한다.

- 앱은 위 테이블과 RPC를 anon/authenticated 키로 직접 호출하지 않는다. 백엔드만 서버 비밀인 `SUPABASE_SERVICE_ROLE_KEY`로 Data API를 사용한다.
- 사용자 인증과 소유권 모델이 공통 계약으로 확정되기 전에는 anon/authenticated RLS policy를 추가하지 않는다. policy 없는 RLS는 해당 역할에 대해 deny-all이다.
- `postgres` 역할이 `public`에 새로 만드는 테이블·함수·시퀀스의 Data API 기본 권한은 제거한다. 새 객체를 노출해야 할 때는 생성 migration에서 RLS와 최소 grant를 명시한다.
- 이 권한 변경은 공개 API 경로, JSON 필드 이름, enum과 상태 전이를 변경하지 않는다.

## 검증 기준

상태 변경은 정상·잘못된 입력·없는 운행·종료 운행·동일 `requestId` 재전송·하차벨 중복·결과 재전송을 검증한다. CI의 `Supabase Boarding SQL` 작업은 전체 migration, 늦은 GPS의 미저장·1회 재처리, 하차벨 단일 생성, 기존 활성 운행 preflight 차단을 실제 PostgreSQL에서 실행한다. 원격 migration 적용, RPC 존재, API-DB 통합 검증은 별도 상태로 기록한다.
