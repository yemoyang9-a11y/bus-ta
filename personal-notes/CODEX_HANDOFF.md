# 백엔드 작업 보고서 · Codex 인수인계

> 작성: Claude (클라우드 세션) · 최신 tip: `af1d554` (이후 문서/체크리스트 커밋 포함, 코드 변경 없음) · 브랜치: `yemo-develop`
> 목적: 0~10단계 백엔드 작업 진행/결과를 codex 가 재검토하고 이어서 작업할 수 있도록 정리한다.
> 팀 공통 기준은 `docs/`(특히 `docs/API_SPEC.md`)와 `CLAUDE.md` 가 우선한다. 이 문서와 충돌 시 공통 문서를 따른다.

---

## 0. 먼저 할 일 (환경 동기화)

```bash
git fetch origin
git checkout yemo-develop
git pull origin yemo-develop          # tip = af1d554
CI=true pnpm install --frozen-lockfile
```

검증 재현 (둘 다 통과해야 정상):
```bash
CI=true pnpm -r --workspace-concurrency=1 typecheck          # PASS
cd apps/server && node --import tsx --test $(find src -name '*.test.ts')   # 33 pass / 0 fail
```

> 주의: Claude 는 클라우드 원격 환경에서만 동작하며 로컬 디스크에 접근하지 못한다.
> 로컬 ↔ 클라우드 교환은 오직 GitHub(origin) 를 통한다. 작업 후 반드시 push, 이어가기 전 반드시 pull.

---

## 1. 전체 진행 요약 (0~10단계)

| 단계 | 내용 | 상태 | 비고 |
|---|---|---|---|
| 0 | 공통 토대 (shared 상수·스키마·타입, `/bell/request`·RING/CANCEL 제거) | ✅ 완료 | |
| 1 | `GET /api/health` + Supabase 연결 상태 | ✅ 완료 | |
| 2 | DB migration (trips/trip_status/bell_logs/bus_beacons/location_logs) | ✅ 완료 | Supabase 적용됨, ref `nsbemlqidbepttjfyumt` |
| 3 | `POST /api/trips` 운행 생성 | ✅ 완료 | `getArrivalInfo` 는 미연결(null) |
| 4 | `PATCH /api/trips/{tripId}/status` 이동 상태 추적 | ✅ 완료 | |
| 5 | 하차벨 자동 요청 생성 (PATCH 내부) | ✅ 완료 | `remainingStations=1 & NOT_REQUESTED` |
| 6 | `GET /api/trips/{tripId}/status` 조회 전용 | ✅ 완료 | |
| 7 | `POST /api/trips/{tripId}/bell/result` 결과 저장 | ✅ 완료 | PENDING→SUCCESS/FAIL, 멱등 |
| 8 | `GET /api/beacons?routeNo=` mock 비콘 | ✅ 완료 | fixture 기반, DB 미사용 |
| 9 | `POST /api/routes/search` 노선 검색 | 🟡 골격(mock) | 효린 모듈 자리만 마련 |
| 10 | 통합 점검 + 문서 정합 | ✅ 완료 | 체크리스트 7항목 통과 |

추가 작업: `.env` 자동 로드, getGuideMessage 공통화, dead code/스텁 제거, 문서 정합.

---

## 2. 커밋 이력 (이 브랜치에서 한 작업, 최신 → 과거)

```
a0db3a4 chore: 미사용 repository 스텁 제거 및 API 문서 우선순위 명시
ff045b2 docs: PATCH /api/trips/{tripId} 미구현(보류) 표기
9bc136e feat: 노선 검색 API 골격 구현 (mock 후보)
b1567fc feat: 비콘 조회 API 구현
ad070a6 refactor: 0~7단계 정리 (안내 문구 공통화·GET message·dead code 제거)
1389a33 feat: 서버 시작 시 .env 자동 로드
5176d62 feat: 하차벨 결과 저장 API 구현
9044dca feat: 운행 상태 조회 API 구현
6308f2d feat: 하차벨 자동 요청 생성 구현
d6a8a31 feat: 2~4단계 DB migration + trip 생성/상태 API
f3cd8c7 feat: implement health check and Supabase status
```

---

## 3. 구현 구조 (재검토 포인트)

서버는 **라우트 → 서비스(순수 로직, 의존성 주입) → repository(외부 I/O)** 구조다.
서비스는 repository 인터페이스를 직접 정의하고 DI 로 받기 때문에, 단위 테스트는 mock repository 로 DB 없이 검증한다.

```
apps/server/src/
  index.ts                         # .env 자동 로드 + express 부팅
  config/supabase.ts               # readSupabaseConfig, getSupabaseConnectionStatus
  routes/
    health.ts  routes.ts  trips.ts  beacons.ts
  services/
    trip/create-trip.service.ts          (3단계)
    trip/update-trip-status.service.ts   (4·5단계, 정류장 계산 + 자동 벨)
    trip/get-trip-status.service.ts      (6단계)
    trip/bell-result.service.ts          (7단계)
    trip/guide-message.ts                (안내 문구 단일 출처)
    beacon/get-beacon.service.ts         (8단계)
    route/search-routes.service.ts       (9단계)
  repositories/
    supabase/trip.repository.ts          # 실제 Supabase(PostgREST) 구현 (trip/status/bell/location)
    beacon.repository.ts                 # FixtureBeaconRepository (DEMO_BEACONS)
  adapters/
    bell/mock-bell.adapter.ts            # mock 하차벨 결과 생성
    routes/mock-route-search.adapter.ts  # mock 노선 후보 (효린 모듈 대체)
```

핵심 계약(재검토 시 확인):
- API 응답 = camelCase, DB 컬럼 = snake_case. repository 매퍼에서 변환.
- 상태: `tripStatus ∈ {WAITING_BUS, ON_BUS, NEAR_DESTINATION, TRIP_DONE, ERROR}`,
  `bellStatus ∈ {NOT_REQUESTED, PENDING, SUCCESS, FAIL}`, 명령 = `STOP_REQUEST` 단일.
- 식별자 분리: `requestId`(위치 멱등) ≠ `bellRequestId`(하차벨 연결). 혼용 금지.
- 하차벨 자동 생성은 **오직 `PATCH /status` 내부**에서, `remainingStations=1 & bellStatus=NOT_REQUESTED` 일 때만.
  `requestId` 중복이면 위치 로그·벨 생성 모두 건너뛴다(멱등).
- `POST /bell/result` 는 `PENDING→SUCCESS/FAIL` 만. 같은 `bellRequestId` 재전송은 기존 결과 반환.

---

## 4. 검증 결과

- 타입체크: PASS, 단위 테스트: **33 pass / 0 fail**
- **실 Supabase end-to-end 검증 완료 (3~7단계)**: 로컬에서 `.env` 설정 후
  `POST /trips → PATCH /status(×N) → 자동 벨(PENDING) → GET /status → POST /bell/result(SUCCESS) → 멱등` 전 구간 성공.
  `trips/trip_status/bell_logs/location_logs` 실제 기록 확인.
- 8·9단계는 fixture/mock 기반이라 DB 미사용.
- 10단계 체크리스트: `/bell/request`·location API·`routeId/stationId/routeDirection/endStationName`·
  `remainingStops/currentStop` 잔재 0건, camelCase/snake_case 정합, `.env.example` 값 없음.

### 로컬 실행 방법
```bash
# apps/server/.env (커밋 금지)
SUPABASE_URL=<Supabase 프로젝트 URL, 대시보드 Settings > API Keys 에서 확인>
SUPABASE_SERVICE_ROLE_KEY=<Secret key, 대시보드 Settings > API Keys > Secret keys 에서 확인>
PORT=3000
# 실행
pnpm --filter @bus-ta/server dev
# 확인 (PowerShell): Invoke-RestMethod http://localhost:3000/api/health  → dbStatus: UP
```

---

## 5. 남은 작업 (codex 가 이어서)

### A. 백엔드 코드
- `PATCH /api/trips/{tripId}` (운행 취소/재시작): **보류 확정**. 문서에 "미구현" 표기됨(501).
  시연에 취소 장면 없음. 필요해지면 `action:"CANCEL"` 스키마로 구현.

### B. 외부 모듈 연동 (자리는 마련됨, 차단요인 아님)
- 효린 `searchRoutes(destination, lat, lng)` → `routes/routes.ts` 의 `mockSearchRoutes` 주입 교체.
- 효린 `getArrivalInfo(selectedCandidate)` → `create-trip.service` 에 연결, 실패 시 `predictedArrivalMinutes:null` 유지 재확인.
- 유나 OpenAI 최종 후보 2개 선택 → 현재 mock 2개로 대체 중.

### C. mock 데이터 값 통일 — **보류(나). 시연용 ODsay 노선 1개 확정이 선행 차단 의존성.**
순서: 노선 확정 → `demo-route.ts` 실제 노선 교체 → `demo-locations.ts` GPS열을
**마지막에서 두 번째 좌표 = 목적지 전 정류장(stationList[length-2])** 이 되도록 역산
(5단계 벨 트리거 위치 일치) → `demo-beacon.ts` 맞춤 → 단위테스트로 트리거 위치 고정.
ODsay 내부 경로유형 값은 공개 API/DB/fixture 에 넣지 않는다.

### D. 예모 범위 밖
- ESP32 펌웨어, `targetBeaconId` 실제 장비값, RN 앱 화면/STT/BLE.

---

## 6. 커밋/푸시 규칙

- 작업 브랜치 `yemo-develop`, `git push -u origin yemo-develop`. `main` 직접 push 금지.
- author/committer = `Claude <noreply@anthropic.com>` 로 맞춰야 GitHub Verified.
  (`git config user.email noreply@anthropic.com && git config user.name Claude`)
- API 요청/응답 변경 시 `docs/API_SPEC.md`, DB 변경 시 `docs/DB_SCHEMA.md` 동기화.
- 미구현 기능을 완료로 표기하지 않는다. 실행하지 않은 테스트를 통과했다고 적지 않는다.
- PR 은 명시 요청 전까지 만들지 않는다.
