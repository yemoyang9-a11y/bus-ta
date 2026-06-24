# API 명세

> 모든 경로는 `packages/shared/src/constants/api-paths.ts`를 단일 진실로 사용한다.

## 유효한 엔드포인트

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | /api/health | 서버 상태 확인 |
| POST | /api/routes/search | 노선 검색 |
| POST | /api/trips | 여정 생성 |
| PATCH | /api/trips/{tripId} | 여정 정보 수정 |
| PATCH | /api/trips/{tripId}/status | tripStatus 강제 변경 |
| GET | /api/trips/{tripId}/status | 현재 상태 조회 (변경 없음) |
| GET | /api/beacons | 비콘 목록 조회 |
| POST | /api/trips/{tripId}/bell/request | 하차벨 요청 (→ PENDING) |
| POST | /api/trips/{tripId}/bell/result | 하차벨 결과 보고 (PENDING →) |

## 폐기된 엔드포인트 (사용 금지)

| 메서드 | 경로 | 대체 |
|---|---|---|
| ~~GET~~ | ~~`/api/trips/{tripId}/bell`~~ | `GET /api/trips/{tripId}/status` 사용 |
| ~~POST~~ | ~~`/api/ble/result`~~ | `POST /api/trips/{tripId}/bell/result` 사용 |

## 상태 전환 규칙

### tripStatus
`WAITING_BUS` → `ON_BUS` → `NEAR_DESTINATION` → `TRIP_DONE`  
오류 발생 시 언제든 `ERROR`로 전환 가능.

### bellStatus
- `POST /bell/request`: `NOT_REQUESTED` 또는 재시도 가능한 `FAIL` → `PENDING`
- `POST /bell/result`: `PENDING` → `SUCCESS` 또는 `FAIL`
- `GET` 조회: 상태 변경 없음
