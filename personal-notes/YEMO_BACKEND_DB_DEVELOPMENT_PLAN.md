# 예모 백엔드·DB 개발 순서도

> **개인 참고용 문서입니다.**
>
> 이 문서는 예모의 백엔드, DB, 이동 상태 추적, 하차 판단 담당 파트를 개발할 때 참고하기 위한 작업 순서입니다. 팀 공통 API 명세나 전체 개발 기준으로 사용하지 않습니다.
>
> 팀 공통 기준은 `README.md`, `AGENTS.md`, `docs/API_SPEC.md`, `docs/DB_SCHEMA.md`, `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT_PLAN.md`를 우선합니다. 이 문서와 공통 문서가 다르면 공통 문서를 기준으로 하고, 차이점은 작업 전에 확인합니다.

**Goal:** 예모 담당 범위인 백엔드 API, DB 스키마, 이동 상태 추적, 하차 판단, 하차벨 결과 저장 흐름을 구현 가능한 순서로 정리한다.

**Architecture:** `packages/shared`의 공통 상수와 스키마를 기준으로 `apps/server` Express API를 구현하고, Supabase PostgreSQL에 `trips`, `trip_status`, `bell_logs`, `bus_beacons`를 저장한다. 앱은 3초마다 `PATCH /api/trips/{tripId}/status`로 위치를 보내고, 백엔드는 DB의 `stationList`와 비교해 남은 정류장을 계산한 뒤 1정거장 전 하차벨 요청을 자동 생성한다.

**Tech Stack:** Node.js, Express, TypeScript, Supabase PostgreSQL, JSON, pnpm workspace

---

## 충돌 방지 규칙

- 이 문서는 예모 개인 작업 순서이며 팀원이 자기 담당 기능의 공통 기준으로 사용하지 않는다.
- 이 문서를 `README.md`, `AGENTS.md`, `CLAUDE.md`에 필수 참고 문서로 추가하지 않는다.
- API 주소, 요청 Body, 응답 Body, DB 필드가 바뀌면 반드시 `docs/API_SPEC.md`와 `docs/DB_SCHEMA.md`를 먼저 수정한다.
- 팀 공통 문서와 이 문서가 다르면 이 문서를 고치고, 코드에서 임의로 다른 흐름을 만들지 않는다.
- `/bell/request`는 사용하지 않는다. 하차벨 요청은 `PATCH /api/trips/{tripId}/status`에서 자동 생성한다.
- 이 문서는 구현 상태를 완료로 표시하지 않는다. 실제 완료 여부는 코드, 실행 결과, 테스트 결과로 판단한다.

## 현재 브랜치에서 확인된 시작 상태

- 백엔드 폴더: `apps/server/`
- DB 폴더: `supabase/`
- 공통 패키지: `packages/shared/`
- 백엔드 라우트 파일은 있으나 주요 API는 아직 `501 Not implemented` 상태다.
- `supabase/migrations/`에는 `.gitkeep`만 있고 실제 테이블 생성 SQL은 아직 없다.
- `apps/server/src/routes/trips.ts`에는 실제 `/bell/request` 라우트가 없고, 사용 금지 주석만 남아 있다.

## 최종 개발 순서 요약

```text
shared 상수·타입 정리
-> health와 Supabase 연결 확인
-> DB migration 작성
-> POST /api/trips 운행 생성
-> PATCH /api/trips/{tripId}/status 이동 상태 추적
-> 하차벨 자동 요청 생성
-> GET /api/trips/{tripId}/status 상태 조회
-> POST /api/trips/{tripId}/bell/result 결과 저장
-> GET /api/beacons?routeNo= mock 비콘 조회
-> POST /api/routes/search 연동
-> 통합 테스트와 문서 불일치 점검
```

## 0단계: 공통 토대 정리

**목표:** 프론트엔드와 백엔드가 같은 API 경로, 상태값, 필드명을 사용하도록 한다.

**확인 파일:**

- `packages/shared/src/constants/api-paths.ts`
- `packages/shared/src/constants/trip-status.ts`
- `packages/shared/src/constants/bell-status.ts`
- `packages/shared/src/constants/bell-command.ts`
- `packages/shared/src/schemas/trip.schema.ts`
- `packages/shared/src/schemas/location.schema.ts`
- `packages/shared/src/schemas/bell.schema.ts`
- `docs/API_SPEC.md`

**작업 순서:**

1. `docs/API_SPEC.md`의 공개 API 목록과 `api-paths.ts`가 일치하는지 확인한다.
2. `tripStatus` 값이 `WAITING_BUS`, `ON_BUS`, `NEAR_DESTINATION`, `TRIP_DONE`, `ERROR`인지 확인한다.
3. `bellStatus` 값이 `NOT_REQUESTED`, `PENDING`, `SUCCESS`, `FAIL`인지 확인한다.
4. 하차벨 명령이 `STOP_REQUEST`로 통일되어 있는지 확인한다.
5. `/bell/request`가 공통 API 경로로 남아 있으면 제거하거나 사용 금지 상태로 표시한다.

**완료 기준:**

- 백엔드 라우트와 프론트엔드 호출이 같은 문자열 상수를 참조할 준비가 되어 있다.
- 구버전 `location` API와 `/bell/request`를 새 구현에서 사용하지 않는다.

## 1단계: 백엔드 기본 실행과 Supabase 연결

**목표:** Express 서버와 DB 연결 상태를 확인하는 출발점을 만든다.

**확인 파일:**

- `apps/server/src/index.ts`
- `apps/server/src/routes/health.ts`
- `apps/server/.env.example`
- `.env.example`
- `apps/server/package.json`

**작업 순서:**

1. `GET /api/health`가 서버 상태를 반환하는지 확인한다.
2. Supabase 연결 클라이언트 파일이 없으면 `apps/server/src/config/` 또는 기존 패턴에 맞는 위치에 만든다.
3. DB 환경변수 이름을 `.env.example`과 `apps/server/.env.example`에 맞춘다.
4. DB 연결이 없을 때는 `dbStatus: "NOT_CONFIGURED"`, 연결 성공 시 `dbStatus: "UP"`처럼 구분한다.

**완료 기준:**

- 서버가 실행된다.
- `GET /api/health`로 서버와 DB 연결 상태를 확인할 수 있다.
- 실제 API 키나 비밀번호를 코드에 쓰지 않는다.

## 2단계: DB 스키마 migration 작성

**목표:** API 구현 전에 저장할 테이블을 먼저 만든다.

**생성 파일 후보:**

- `supabase/migrations/20260701_create_backend_mvp_tables.sql`

**우선순위 테이블:**

```text
trips
trip_status
bell_logs
bus_beacons
```

**선택 테이블:**

```text
location_logs
system_logs
```

**중간평가 이후 확장 테이블:**

```text
ble_logs
vibration_logs
users
```

**작업 순서:**

1. `trips` 테이블을 먼저 만든다.
2. `trip_status`는 `trips.trip_id`를 참조하는 1:1 테이블로 만든다.
3. `bell_logs`는 `trip_id`, `bell_request_id`, `command`, `result`, `requested_at`, `completed_at`을 저장한다.
4. `bus_beacons`는 `route_no`, `local_bus_id`, `vehicle_id`, `target_beacon_id`, `is_mock`을 저장한다.
5. 위치 로그가 필요하면 `location_logs`에 `trip_id + request_id` 고유 조건을 둔다.

**중요 규칙:**

- 정류장 객체에는 중간평가 기준 `station_id`를 넣지 않는다.
- `station_list`는 JSON 배열로 저장한다.
- 남은 정류장 수는 `sequence` 차이가 아니라 `station_list` 배열 인덱스로 계산한다.
- `route_id`, `route_direction`, `end_station_name`을 중간평가 필수 컬럼으로 만들지 않는다.

**완료 기준:**

- Supabase에서 핵심 테이블을 생성할 수 있다.
- `docs/DB_SCHEMA.md`와 migration 필드가 어긋나지 않는다.

## 3단계: 운행 생성 API 구현

**대상 API:** `POST /api/trips`

**수정 파일 후보:**

- `apps/server/src/routes/trips.ts`
- `apps/server/src/repositories/trip.repository.ts`
- `packages/shared/src/schemas/trip.schema.ts`
- `docs/API_SPEC.md`

**처리 흐름:**

```text
요청 Body 검증
-> stationList 검증
-> boardingStation이 stationList 첫 항목과 같은지 확인
-> destinationStation이 stationList 마지막 항목과 같은지 확인
-> getArrivalInfo(selectedCandidate) 내부 호출
-> tripId 발급
-> trips 저장
-> trip_status 초기행 생성
-> tripStatus = WAITING_BUS
-> bellStatus = NOT_REQUESTED
```

**검증 규칙:**

- `stationList`는 2개 이상이어야 한다.
- 첫 정류장은 탑승 정류장과 `stationName`, 좌표가 같아야 한다.
- 마지막 정류장은 목적지 정류장과 `stationName`, 좌표가 같아야 한다.
- `sequence`는 오름차순이어야 하지만 불연속일 수 있다.
- `localBusId`, `gbisStationId`, `routeNo`, `candidateId`를 저장한다.

**완료 기준:**

- API가 `tripId`를 발급한다.
- `trips`와 `trip_status`가 함께 저장된다.
- GBIS 도착정보 실패 시에도 `predictedArrivalMinutes: null`로 운행 생성이 가능하다.

## 4단계: 이동 상태 추적 API 구현

**대상 API:** `PATCH /api/trips/{tripId}/status`

**수정 파일 후보:**

- `apps/server/src/routes/trips.ts`
- `apps/server/src/services/trip/trip-progress.service.ts`
- `apps/server/src/repositories/trip.repository.ts`
- `apps/server/src/repositories/location.repository.ts`
- `packages/shared/src/schemas/location.schema.ts`

**처리 흐름:**

```text
tripId로 운행 조회
-> requestId 중복 여부 확인
-> 현재 좌표 수신
-> stationList와 거리 비교
-> 현재 정류장 판단
-> 다음 정류장 판단
-> 남은 정류장 수 계산
-> 역행 또는 다중 점프 보정
-> tripStatus 갱신
-> trip_status 저장
-> location_logs 저장
```

**상태 전환 기준:**

```text
첫 유효 좌표 -> ON_BUS
remainingStations <= 2 -> NEAR_DESTINATION
remainingStations = 0 -> TRIP_DONE
```

**보정 규칙:**

- 새 현재 정류장 인덱스가 이전 인덱스보다 작으면 역행으로 보고 무시한다.
- 새 현재 정류장 인덱스가 이전 인덱스보다 2칸 이상 크면 한 칸 전진으로 보정한다.
- `requestId`가 중복이면 새 로그와 새 하차벨 요청을 만들지 않고 기존 결과를 반환한다.

**완료 기준:**

- 앱이 3초마다 좌표를 보내면 현재·다음·남은 정류장 수가 갱신된다.
- `tripStatus`가 이동 상태에 따라 바뀐다.
- 같은 `tripId + requestId` 요청이 중복 처리되지 않는다.

## 5단계: 하차벨 자동 요청 생성

**대상 API:** `PATCH /api/trips/{tripId}/status` 내부

**수정 파일 후보:**

- `apps/server/src/routes/trips.ts`
- `apps/server/src/repositories/bell.repository.ts`
- `apps/server/src/adapters/bell/mock-bell.adapter.ts`
- `packages/shared/src/schemas/bell.schema.ts`

**자동 생성 조건:**

```text
remainingStations = 1
AND bellStatus = NOT_REQUESTED
```

**처리 흐름:**

```text
bellRequestId 생성
-> command = STOP_REQUEST
-> bell_logs에 요청 로그 저장
-> trip_status.bellStatus = PENDING
-> 응답에 shouldTriggerBell: true 반환
-> 응답에 bellRequestId, command 포함
```

**금지 규칙:**

- `POST /api/trips/{tripId}/bell/request`를 사용하지 않는다.
- `GET /api/trips/{tripId}/status`에서 하차벨 요청을 생성하지 않는다.
- `bellStatus`가 `PENDING`, `SUCCESS`, `FAIL`이면 중복 요청을 만들지 않는다.

**완료 기준:**

- 남은 정류장이 1개일 때 백엔드가 자동으로 `STOP_REQUEST`를 생성한다.
- 앱은 응답의 `bellRequestId`와 `command`만 받아 mock 또는 실제 하차벨에 전달하면 된다.

## 6단계: 상태 조회 API 구현

**대상 API:** `GET /api/trips/{tripId}/status`

**수정 파일 후보:**

- `apps/server/src/routes/trips.ts`
- `apps/server/src/repositories/trip.repository.ts`

**응답 필드:**

```text
tripId
destination
routeNo
currentStation
nextStation
remainingStations
tripStatus
bellStatus
shouldTriggerBell
bellRequestId
command
guideMessage
```

**중요 규칙:**

- 조회 전용이다.
- DB 상태를 바꾸지 않는다.
- 하차벨 요청을 새로 만들지 않는다.
- `bellStatus = PENDING`이면 “하차벨 요청 결과를 기다리고 있습니다.” 같은 안내를 반환한다.

**완료 기준:**

- 프론트엔드가 현재 이동 상태와 하차벨 처리 상태를 조회할 수 있다.
- 같은 조회를 반복해도 상태가 변하지 않는다.

## 7단계: 하차벨 결과 저장 API 구현

**대상 API:** `POST /api/trips/{tripId}/bell/result`

**수정 파일 후보:**

- `apps/server/src/routes/trips.ts`
- `apps/server/src/repositories/bell.repository.ts`
- `packages/shared/src/schemas/bell.schema.ts`

**처리 흐름:**

```text
tripId와 bellRequestId 검증
-> 기존 bell_logs 요청 로그 조회
-> bellStatus = PENDING인지 확인
-> result = SUCCESS이면 bellStatus = SUCCESS
-> result = FAIL이면 bellStatus = FAIL
-> bell_logs 결과 필드 저장
-> 같은 bellRequestId 재전송이면 기존 결과 반환
```

**금지 규칙:**

- 이 API에서 `NOT_REQUESTED -> PENDING` 전환을 하지 않는다.
- `bellRequestId` 없이 결과를 저장하지 않는다.
- 이미 `SUCCESS` 또는 `FAIL` 처리된 요청에 새 결과를 덮어쓰지 않는다.

**완료 기준:**

- mock 하차벨 성공/실패 결과가 DB에 저장된다.
- `trip_status.bellStatus`가 `SUCCESS` 또는 `FAIL`로 바뀐다.

## 8단계: 비콘 조회 API 구현

**대상 API:** `GET /api/beacons?routeNo=`

**수정 파일 후보:**

- `apps/server/src/routes/beacons.ts`
- `apps/server/src/repositories/beacon.repository.ts`
- `packages/shared/src/fixtures/demo-beacon.ts`

**처리 흐름:**

```text
routeNo 검증
-> bus_beacons 또는 fixture에서 targetBeaconId 조회
-> 중간평가에서는 mock targetBeaconId 반환
```

**완료 기준:**

- 앱이 선택 노선의 `targetBeaconId`를 조회할 수 있다.
- 중간평가에서는 mock 값으로 시연 가능하다.

## 9단계: 노선 검색 API 연동

**대상 API:** `POST /api/routes/search`

**수정 파일 후보:**

- `apps/server/src/routes/routes.ts`
- `packages/shared/src/schemas/route.schema.ts`
- `docs/MODULE_CONTRACTS.md`

**처리 흐름:**

```text
destination, latitude, longitude 수신
-> 효린 searchRoutes(destination, latitude, longitude) 호출
-> 카카오 로컬 API와 ODsay 후보 조회
-> 직행 버스 후보 필터링
-> 유나 OpenAI 모듈로 최종 후보 2개 선택
-> 앱에 routes 배열 반환
```

**중요 규칙:**

- 도착 예정 시간은 여기서 조회하지 않는다.
- 도착 예정 시간은 사용자가 후보를 선택한 뒤 `POST /api/trips` 내부에서 `getArrivalInfo(selectedCandidate)`로 조회한다.
- 효린 모듈이 늦어지면 mock 후보 데이터로 3~8단계를 먼저 완성한다.

**완료 기준:**

- 실제 모듈 또는 mock 데이터로 앱이 경로 후보를 받을 수 있다.
- 반환 후보는 `candidateId`, `routeNo`, `localBusId`, `gbisStationId`, `stationList`를 포함한다.

## 10단계: 통합 테스트와 문서 불일치 점검

**테스트 순서:**

```text
GET /api/health
POST /api/trips
PATCH /api/trips/{tripId}/status
GET /api/trips/{tripId}/status
PATCH /api/trips/{tripId}/status  # remainingStations = 1
POST /api/trips/{tripId}/bell/result
GET /api/trips/{tripId}/status
GET /api/beacons?routeNo=
```

**점검 항목:**

- `/bell/request` 라우트가 공개 API로 남아 있지 않은가
- `location` API 경로가 남아 있지 않은가
- `routeId`, `stationId`, `routeDirection`, `endStationName`이 중간평가 요청/응답에 남아 있지 않은가
- `remainingStops`와 `remainingStations`가 섞여 있지 않은가
- `currentStop`과 `currentStation`이 섞여 있지 않은가
- API 응답 필드가 `camelCase`인가
- DB 컬럼이 `snake_case`인가
- `.env.example`에 실제 값이 없는가

**완료 기준:**

- Postman 또는 실행 스크립트로 중간평가 흐름을 한 번 이상 통과한다.
- 실행하지 않은 테스트는 성공했다고 기록하지 않는다.
- 코드와 문서가 다르면 문서를 숨기지 않고 차이점을 보고한다.

## 개인 개발 우선순위

1. `packages/shared` 상수와 스키마에서 `/bell/request`, `remainingStops` 같은 구버전 흔적 확인
2. Supabase migration 작성
3. `POST /api/trips` 구현
4. `PATCH /api/trips/{tripId}/status` 구현
5. 하차벨 자동 요청 생성 구현
6. `GET /api/trips/{tripId}/status` 구현
7. `POST /api/trips/{tripId}/bell/result` 구현
8. `GET /api/beacons?routeNo=` 구현
9. mock 기반 통합 테스트
10. 효린·유나 모듈 실제 연동

## 나중에 해야 할 것

- 서버 실행 환경에 `SUPABASE_URL`과 `SUPABASE_SERVICE_ROLE_KEY`를 설정한 뒤 실제 API 호출로 DB 저장 흐름을 확인한다. 백엔드는 service-role 전용이며 `SUPABASE_ANON_KEY`를 사용하지 않는다.
- 효린 `getArrivalInfo(selectedCandidate)` 실제 모듈이 repo에 들어오면 `POST /api/trips` 생성 흐름에 연결하고, 실패 시 `predictedArrivalMinutes: null`로 계속 진행되는지 재확인한다.

## 커밋 단위 제안

```text
chore: shared API 상수와 상태값 정리
feat: Supabase MVP 테이블 migration 추가
feat: 운행 생성 API 구현
feat: 위치 기반 이동 상태 추적 구현
feat: 하차벨 자동 요청 생성 구현
feat: 하차벨 결과 저장 API 구현
feat: mock 비콘 조회 API 구현
test: 백엔드 중간평가 흐름 검증 추가
docs: 백엔드 구현 상태 문서 동기화
```
