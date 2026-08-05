# 공통 데이터 모델 및 상태 명세

> 문서 상태: 최종 계약이며 상태 전이의 단일 출처다. 실제 DB 적용 여부는 migration 파일만으로 판단하지 않고 Supabase 적용 기록 또는 조회로 확인한다.

## 기준과 구현 상태

현재 구현 사실은 `yemo-develop`의 서버·`packages/shared`·현재 테스트를 기준으로 하며, 실제 DB 적용 여부는 저장소 migration 이력과 분리해 Supabase 적용 기록 또는 조회로 검증한다. 이 문서는 합의된 목표 계약이다. 둘이 다르면 어느 한쪽을 묵시적으로 고치지 않고 차이, 영향 소비자, 결정 및 검증 계획을 PR에 남긴다.

## 공통 식별자와 모델

| 모델 | 핵심 필드 |
| --- | --- |
| Station | `stationName`, `latitude`, `longitude`, `sequence` |
| Route candidate | `candidateId`, `routeNo`, `localBusId`, `gbisStationId`, `boardingStation`, `destinationStation`, `stationList` |
| Trip | `tripId`, 선택 후보 정보, `tripStatus`, `bellStatus`, `predictedArrivalMinutes` |
| Location update | `requestId`, `latitude`, `longitude`, `recordedAt`, `source` |
| Bell result | `bellRequestId`, `result`, `message`, `isMock` |
| Beacon | `routeNo`, `localBusId`, `vehicleId`, `targetBeaconId`, `isMock` |

`requestId`는 `tripId` 안에서 위치 업데이트 멱등 키이고, `bellRequestId`는 하차벨 요청과 결과를 잇는 키다. `recordedAt`은 ISO 8601 시간으로 전달한다. ODsay 내부 경로 유형 값은 공개 API·DB·공통 계약에 포함하지 않는다.

`candidateId`(공개 API)와 `candidate_id`(DB)는 필수 양의 정수(1 이상) 계약이다.

## Enum

```text
tripStatus: WAITING_BUS | ON_BUS | NEAR_DESTINATION | TRIP_DONE | CANCELLED
bellStatus: NOT_REQUESTED | PENDING | SUCCESS | FAIL
source: GPS | MOCK | MANUAL
command: STOP_REQUEST
```

## 운행 상태 전이

```text
POST /trips → WAITING_BUS
PATCH /status (수락된 위치) → ON_BUS 또는 NEAR_DESTINATION 또는 TRIP_DONE
PATCH /trips (end_trip) → CANCELLED
```

- 종료 상태인 `CANCELLED`, `TRIP_DONE`에는 새 위치 업데이트를 반영하지 않는다.
- 같은 `tripId + requestId`는 최초 처리 결과를 재사용한다. 종료된 운행이라도 이미 처리한 `requestId`면 200을 반환하고, 새 키면 409을 반환한다.

## 하차벨 상태 전이

```text
NOT_REQUESTED --(PATCH /status, remainingStations = 1)--> PENDING
PENDING --(POST /bell/result)--> SUCCESS | FAIL
```

- 하차벨 요청은 서버가 단 한 번 생성하며, `PENDING` 또는 `SUCCESS`에서 재생성하지 않는다.
- `remainingStations = 2`에서는 안내만 한다.
- 결과 저장은 `PENDING` 상태에서만 가능하며 그 밖의 요청은 `409 INVALID_BELL_STATE`다.

## DB 매핑 원칙

공개 API의 `tripId`, `candidateId`, `routeNo`, `localBusId`, `gbisStationId`, `requestId`, `bellRequestId`, `tripStatus`, `bellStatus`, `remainingStations`는 각각 같은 의미의 `snake_case` 컬럼으로 매핑한다. 위치 로그는 `UNIQUE(trip_id, request_id)` 제약을 권장하며, 제약 오류를 그대로 500으로 누출하지 않도록 멱등 처리 경로를 둔다.

## 검증 기준

상태 변경은 정상·잘못된 입력·없는 운행·종료 운행·동일 `requestId` 재전송·하차벨 중복·결과 재전송을 검증한다. migration 작성, 실제 적용, RPC 존재, API-DB 통합 검증은 별도 상태로 기록한다.
