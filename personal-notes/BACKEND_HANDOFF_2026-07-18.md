# 백엔드 방향 전환 · 인수인계 (2026-07-18)

> 작성: Claude (클라우드 세션) · 브랜치: `claude/nice-archimedes-iv7iu0` · 최신 tip: `d8ae752`
> 목적: "중간평가 완료 → 실 데이터 전환" 방향 전환 논의와, 이를 위한 문서 동기화 작업, 백엔드 3파트(예모/효린/유나) 코드 분석 결과를 이어받을 수 있도록 정리한다.
> 팀 공통 기준은 `docs/`(특히 `docs/API_SPEC.md`, `docs/DB_SCHEMA.md`)와 `CLAUDE.md`가 우선한다. 이 문서와 충돌 시 공통 문서를 따른다.
> 민감정보(키·토큰·URL) 없음 — 안전하게 공유 가능.

---

## 0. 오늘 세션에서 일어난 일 (요약)

1. GitHub 로컬 문서(README/CLAUDE.md/docs)와 노션 원본("프로젝트 개요(필독)", "7/1 중간평가 개발 범위")을 대조 → 로컬 문서들의 "전체 흐름" 요약이 **스마트지팡이 기반 탑승 전 버스 식별(비콘 조회→BLE 스캔→RSSI→진동) 구간을 통째로 빠뜨리고** 있는 불일치 발견.
2. 사용자가 방향을 명시적으로 전환: **중간평가는 끝났고, 이제 mock이 아닌 실제 데이터가 오가는 것이 목표. 특히 버스 비콘을 최우선으로.**
3. 이 방향에 맞춰 GitHub 로컬 문서 5개 + 노션 원본 2개를 갱신하고, 변경 내역을 정리한 노션 요약 페이지를 새로 생성.
4. 사용자가 "각 파트가 최종 형태로 맞물려 돌아가려면 뭘 고쳐야 하는지" 분석을 요청 → 먼저 백엔드(예모 본인 파트 + 효린 버스 API 모듈 + 유나 OpenAI 모듈) 코드를 직접 읽고 분석·보고함.

---

## 1. 완료된 작업

### 1-1. 문서 동기화 (완료)

| 문서 | 변경 내용 |
|---|---|
| `README.md` | 전체 흐름에 비콘 조회~진동 안내 구간 삽입, "현재 개발 상태"를 중간평가 완료+실 데이터 전환 목표로 갱신 |
| `CLAUDE.md` | 흐름도에 동일 구간 삽입 |
| `docs/PROJECT_OVERVIEW.md` | 전체 서비스 흐름·프로젝트 목표에 비콘 단계 추가, "현재 구현 범위"·"중간평가와 최종평가 범위" 갱신 |
| `docs/ARCHITECTURE.md` | 상단 흐름에 비콘 구간 삽입, "하드웨어 구성" 절 신설(ESP32 2대: 버스측 비콘+하차벨 겸용 / 스마트지팡이), BLE·DB 절 문구 갱신 |
| `docs/MIDTERM_SCOPE.md` | 상단에 "중간평가 완료, 현재 목표는 PROJECT_OVERVIEW 참고" 안내 추가, 담당 흐름에 정민(스마트지팡이) 구간 추가 |

검증: `git diff --stat`, `git diff`로 5개 파일 변경분 직접 확인함. 코드 변경 없음 — 빌드/테스트 대상 아님. **이 5개 파일은 아직 커밋되지 않은 워킹 트리 변경 상태**이니 이어받는 사람이 커밋 여부를 확인할 것.

### 1-2. 노션 동기화 (완료)

- **"프로젝트 개요(필독)"** (`https://app.notion.com/p/367ff779d691807a83ade2f6106b1309`): 인트로 뒤에 진행 상태 콜아웃 추가, "개발 문서 공통 규격" 절에 "1-1. 중간평가 이후(현재) 데이터 사용 기준" 신설.
- **"7/1 중간평가 개발 범위"** (`https://app.notion.com/p/385ff779d69181d09b48faafcd244314`): 최상단에 "중간평가 완료, 최신 방향은 프로젝트 개요(필독) 참고" 콜아웃 추가.
- **신규 요약 페이지** "GitHub 문서 동기화 — 변경사항 및 남은 문제 (2026-07-18)": `https://app.notion.com/p/3a1ff779d69181138938e2ea38a3a9e6`
- 검증: 두 원본 페이지 모두 수정 후 `fetch`로 재조회해 기존 내용 손상 없이 유지된 것을 확인함.

---

## 2. 백엔드 코드 분석 결과 (진행 중 — 다음 단계로 이어받을 내용)

`apps/server/src` 전체를 직접 읽고 확인함. **결론: 외부 API·DB 레벨은 이미 대부분 실 연동돼 있고(mock 아님), 진짜 남은 건 모듈 간 배선 문제 두 가지.**

### 2-1. 예모 — 백엔드/PM/DB

- 확인됨: `POST/PATCH/GET /api/trips*`, `POST /api/trips/{id}/bell/result` 전부 `SupabaseTripRepository`로 실제 DB read/write. mock 없음.
- 고칠 부분:
  1. `services/trip/create-trip.service.ts:140` — `vehicleId: null` 고정. `CreateTripRequestSchema`에 `vehicleId` 필드 자체가 없음. **버스 비콘 차량 단위 매칭의 근본 블로커.**
  2. `repositories/supabase/beacon.repository.ts:42-50` `findByRouteNo` — `route_no`로만 매칭, `bus_beacons.vehicle_id` 컬럼(`docs/DB_SCHEMA.md:146`)을 안 씀. 같은 노선에 버스 여러 대 실 운행 시 임의의 비콘을 반환할 위험.
  3. `routes/beacons.ts:14` — Supabase 미설정 시 조용히 `FixtureBeaconRepository`(mock)로 fallback. 운영 배포 시 환경변수 누락을 못 알아챌 위험.
  4. `services/beacon/get-beacon.service.ts:36-37` — "중간평가에서는 fixture mock 반환" docstring이 실제 동작(실DB 우선)과 어긋난 stale 주석.
  5. `routes/trips.ts:38-40` `PATCH /api/trips/:tripId` 501 미구현 — 최종 운영에 필요한지 팀 결정 필요.

### 2-2. 효린 — 버스 API 모듈 (`adapters/routes/hyorin-route-search.adapter.ts`)

- 확인됨: 카카오 Geocoding·ODsay `searchPubTransPathT`·GBIS `getBusArrivalListv2` 전부 실제 axios 호출, `routes.ts`/`trips.ts`에 실배선됨. `mock-route-search.adapter.ts`는 테스트에서만 쓰이고 프로덕션엔 연결 안 됨(정상).
- 고칠 부분:
  1. 차량 단위 식별자를 전혀 추출하지 않음 — 2-1-1과 직결. GBIS가 실시간 차량 식별자를 제공하는지부터 효린과 확인 필요.
  2. `hyorin-route-search.adapter.ts:76` `busSubPaths.length !== 1` — 환승 없는 직행 버스만 필터링하는 중간평가 제약이 그대로 남음. 최종에도 유지할지 팀 결정 필요.
  3. 에러 코드가 뭉뚱그려짐 — Kakao/ODsay 실패 모두 `502 ROUTE_SEARCH_FAILED` 하나로 처리(`search-routes.service.ts:96`). `docs/API_SPEC.md:698-701`은 `GEOCODING_FAILED`/`BUS_API_ERROR`를 구분해서 정의함.
  4. `distanceKm()`의 위경도→km 근사 계수(111, 88)가 haversine이 아닌 약식 계산. 급한 건 아님.

### 2-3. 유나 — OpenAI 모듈 (`services/guide.ts`)

- 확인됨: `generateRouteGuide`가 실제 OpenAI(`gpt-4o-mini`) 호출 + 실패 시 결정론적 점수 폴백. `search-routes.service.ts`에 연결돼 `POST /api/routes/search` 응답에 실반영됨. 이미 최종 상태에 가까움.
- **가장 중요한 발견**: `generateTripStartGuide`, `generateMovingGuide`, `generateErrorGuide`가 `guide.ts`에 구현돼 있는데 **서버 어디에서도 호출되지 않음**(grep 결과 참조 0건). `PATCH/GET /api/trips/{tripId}/status`는 대신 `services/trip/guide-message.ts`의 정적 템플릿(`buildGuideMessage`)만 씀. 즉 탑승 대기·이동 중·하차 안내 문장이 AI가 아니라 고정 문구. 노션 스펙(탑승/이동/하차 안내까지 AI 생성)과 어긋남 — 배선 누락.

---

## 3. 다음 작업 후보 (우선순위 미정 — 사용자 판단 필요)

1. `vehicleId`를 요청 스키마(`CreateTripRequestSchema`)·`Route` 타입·`bus_beacons` 조회 로직 전체에 배선(효린 응답 스키마 확장이 선행 조건)
2. `generateMovingGuide`/`generateTripStartGuide`를 `update-trip-status.service.ts`/`get-trip-status.service.ts`에 연결(실패 시 `buildGuideMessage` 폴백)
3. 위 5개 문서 변경사항 커밋 여부 결정
4. 프론트(채린)·하드웨어(정민) 파트도 같은 방식으로 분석 요청 여부

---

## 4. 알려진 이슈 / 주의사항

- `bus_beacons` 실DB 시드는 mock 노선(1551) 1건뿐(`supabase/migrations/20260716_seed_bus_beacons.sql`) — 정민의 실물 비콘 데이터가 들어와야 비콘 실 연동이 실질적으로 완성됨.
- `personal-notes/PENDING_DECISIONS.md`, `personal-notes/REMAINING_CHECKLIST.md`에 이전 세션에서 남긴 미결 사항이 있음 — 이번 방향 전환 논의 전 항목들이라 최신화 필요할 수 있음.
- 이 문서 자체는 분석 스냅샷이며, 실제 코드는 계속 바뀔 수 있으니 착수 전 관련 파일을 다시 확인할 것.
