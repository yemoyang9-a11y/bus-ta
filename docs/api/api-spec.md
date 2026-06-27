# API 명세 요약

> 상세 MVP 명세는 [../API_SPEC.md](../API_SPEC.md)를 기준으로 한다.
> 모든 API 경로와 상태값은 `packages/shared/src/constants/`와 문서가 서로 어긋나지 않도록 관리한다.

## 사용 API

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/api/health` | 서버와 DB 상태 확인 |
| POST | `/api/routes/search` | 목적지 기반 경로 후보 조회 |
| POST | `/api/trips` | 사용자가 선택한 후보로 운행 생성 |
| PATCH | `/api/trips/{tripId}` | 운행 취소 또는 시연 재시작용 상태 수정 (미구현, 중간평가 범위 밖) |
| PATCH | `/api/trips/{tripId}/status` | GPS/mock 위치 업데이트, 현재 상태 계산, 하차벨 요청 자동 생성 |
| GET | `/api/trips/{tripId}/status` | 현재 운행 상태 조회, 상태 변경 없음 |
| GET | `/api/beacons?routeNo=` | 중간평가용 mock 비콘 ID 조회 |
| POST | `/api/trips/{tripId}/bell/result` | 하차벨 처리 결과 저장 |

## 사용하지 않는 API

- `POST /api/trips/{tripId}/bell/request`
- `GET /api/trips/{tripId}/bell`
- `POST /api/ble/result`

하차벨 요청은 별도 `/bell/request` 호출 없이 `PATCH /api/trips/{tripId}/status` 처리 중 자동 생성한다.

## 상태 전환 규칙

- `tripStatus`: `WAITING_BUS -> ON_BUS -> NEAR_DESTINATION -> TRIP_DONE`
- `bellStatus`: `NOT_REQUESTED -> PENDING -> SUCCESS/FAIL`
- `GET /api/trips/{tripId}/status`는 조회 전용이며 상태를 바꾸지 않는다.
- `PATCH /api/trips/{tripId}/status`에서 `remainingStations = 1`이고 `bellStatus = NOT_REQUESTED`이면 백엔드가 `bellRequestId`와 `STOP_REQUEST`를 생성하고 `bellStatus = PENDING`으로 변경한다.
- `POST /api/trips/{tripId}/bell/result`는 같은 `bellRequestId`로 결과를 받아 `PENDING -> SUCCESS/FAIL`로 변경한다.

## 식별자 구분

- `requestId`: GPS/mock 위치 업데이트 멱등성 확인용
- `bellRequestId`: 하차벨 요청과 결과 연결용

두 식별자는 서로 다른 목적이므로 혼용하지 않는다.
