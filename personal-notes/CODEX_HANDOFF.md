# Codex 인수인계 문서

> Claude(클라우드 세션)가 작업한 내용을 codex/로컬에서 이어가기 위한 인수인계 메모입니다.
> 팀 공통 기준이 아니라 예모 개인 작업 연속성을 위한 문서입니다.
> 공통 기준은 `docs/`와 `CLAUDE.md`를 우선합니다.

## 1. 작업 위치와 브랜치

- 작업 브랜치: **`yemo-develop`** (`claude/...` 브랜치는 더 이상 사용하지 않음)
- 원격 저장소: **GitHub `yemoyang9-a11y/bus-ta`**
- 최신 커밋(원격 `origin/yemo-develop` 기준):
  - `6308f2d feat: 하차벨 자동 요청 생성 구현`  ← 5단계 (Claude 작업)
  - `d6a8a31 feat: 2~4단계 DB migration + trip 생성/상태 API`

## 2. 작업 시작 전 항상 먼저 실행

```bash
# 로컬에서
git fetch origin
git checkout yemo-develop
git pull origin yemo-develop
git log --oneline -5     # 맨 위가 6308f2d 인지 확인
```

> 주의: Claude는 클라우드 원격 환경에서만 동작하고 로컬 디스크에 접근할 수 없다.
> 로컬 ↔ 클라우드는 오직 GitHub(origin)를 통해서만 주고받는다.
> 한쪽에서 작업하면 반드시 push, 다른 쪽에서 이어가기 전 반드시 pull 한다.

## 3. 지금까지 완료된 단계 (예모 개발 계획 기준)

- **0단계** 공통 토대 정리: shared 상수/스키마/타입 최신화, `/bell/request`·RING/CANCEL 등 구버전 흔적 제거, `latest-contract.typecheck.ts` 추가.
- **1단계** `GET /api/health` + Supabase 연결 상태(`dbStatus`) — codex 작업.
- **2단계** DB migration: `supabase/migrations/20260701_create_backend_mvp_tables.sql`
  (`trips`, `trip_status`, `bell_logs`, `bus_beacons`, `location_logs`). Supabase 원격에도 db push 적용 확인됨. 프로젝트 ref: `nsbemlqidbepttjfyumt`.
- **3단계** `POST /api/trips` 운행 생성: `create-trip.service.ts`(+테스트), `trip.repository.ts`.
- **4단계** `PATCH /api/trips/{tripId}/status` 이동 상태 추적: `update-trip-status.service.ts`(+테스트), `trip-progress.service.ts`.
- **5단계** 하차벨 자동 요청 생성 — **Claude 작업 (커밋 `6308f2d`)**.

## 4. 5단계에서 Claude가 한 일 (이번 커밋 핵심)

`PATCH /api/trips/{tripId}/status` 처리 **내부에서만** 하차벨을 자동 생성한다.

- 트리거 조건: `remainingStations === 1 && bellStatus === NOT_REQUESTED`
- 처리: `bellRequestId` 생성 → `command = STOP_REQUEST` → `bell_logs`에 요청 기록 → `trip_status.bellStatus = PENDING`
- 응답 추가 필드: `shouldTriggerBell: true`, `bellRequestId`, `command: "STOP_REQUEST"`, `bellStatus: PENDING`
- 중복 방지: `bellStatus`가 `PENDING/SUCCESS/FAIL`이면 새 요청 안 만듦
- `POST /bell/request` 라우트 만들지 않음, `GET /status`는 손대지 않음

수정 파일:
- `apps/server/src/services/trip/update-trip-status.service.ts`
  (트리거 로직, `BellRequestCreateRecord` 타입, 응답 바디 `shouldTriggerBell: boolean`/`command`, `generateBellRequestId` 의존성, `bellRequest`는 트리거 시에만 save 입력에 포함)
- `apps/server/src/repositories/supabase/trip.repository.ts`
  (`bellRequest` 있을 때만 `bell_logs` insert — `toBellLogRow`)
- `apps/server/src/services/trip/update-trip-status.service.test.ts` (5단계 테스트 3개 추가)

## 5. 검증 방법 (이미 통과 확인된 명령)

```bash
# 워크스페이스 타입체크 (CI=true 필요 — TTY 없는 환경에서 pnpm install 자동 진행)
CI=true pnpm -r --workspace-concurrency=1 typecheck      # EXIT 0

# trip 서비스 테스트 (node:test + tsx 로더)
cd apps/server
node --import tsx --test \
  src/services/trip/create-trip.service.test.ts \
  src/services/trip/update-trip-status.service.test.ts   # 10 pass / 0 fail

git diff --check                                          # clean
```

## 6. 남아 있는 작업 (다음 순서)

권장 순서:
1. **6단계** `GET /api/trips/{tripId}/status` 구현 (현재 501).
   조회 전용, DB 상태 변경 금지, 하차벨 요청 새로 만들지 않음.
   응답 필드: tripStatus, currentStation, nextStation, remainingStations,
   bellStatus, shouldTriggerBell, bellRequestId, command, guideMessage.
2. **7단계** `POST /api/trips/{tripId}/bell/result` 구현 (현재 501).
   5단계가 만든 PENDING을 닫는 짝. `bellRequestId`로 기존 `bell_logs` 조회 →
   `PENDING → SUCCESS/FAIL`, `trip_status.bellStatus` 갱신, 같은 bellRequestId 재전송이면 기존 결과 반환(멱등).
   `mock-bell.adapter.ts`가 mock 결과 생성 담당.
3. **★ 7단계 직후: 실제 Supabase 키로 end-to-end 1회 검증** (문제 A, 아래 참고).
4. **8단계** `GET /api/beacons?routeNo=` (mock 비콘), **9·10단계**.

## 7. 미검증 / 보류 항목

- **(A) Supabase 실연동 미검증**: 서비스↔repository가 의존성 주입으로 분리돼 3~8단계는 mock 단위 테스트로 검증 가능. 단 SQL 컬럼명·PostgREST 형식·unique 제약은 실 DB에 쏴봐야 드러남.
  데드라인: **10단계(통합 테스트) 전 필수**, 최적 시점은 **7단계 완료 직후**.
  방법: 로컬 `apps/server/.env`에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`(또는 `ANON_KEY`) 설정(절대 커밋 금지) → 서버 실행 → 계획서 10단계 순서로 호출 → `remainingStations=1` 만들어 `bell_logs` insert와 `bellStatus=PENDING` 대시보드 확인.
- **(B) mock 데이터 통일 — 보류(나) 결정됨**: 시연용 ODsay 노선 1개를 팀이 먼저 확정한 뒤에 진행한다.
  현재 `fixtures/demo-route.ts`, `demo-locations.ts`, `demo-beacon.ts`는 placeholder 상태.
  노선 확정 후: `demo-route.ts`를 실제 노선으로 교체 → `demo-locations.ts` GPS열을
  **마지막에서 두 번째 좌표가 "목적지 전 정류장"(stationList[length-2])에 가장 가깝도록** 역산해서 작성
  (그래야 5단계 자동 벨이 그 시점에 울림) → `demo-beacon.ts` 맞춤.
  ODsay 내부 경로유형 값은 공개 API/DB/fixture에 넣지 않는다.
- **(C) 효린 `getArrivalInfo(selectedCandidate)` 미연결**: 현재 `predictedArrivalMinutes: null` 기본값으로 안전 동작. 실모듈 들어오면 `create-trip.service.ts` 의존성으로 주입, 실패 시 null 유지 재확인. 차단 요인 아님.

## 8. 커밋/푸시 규칙

- 작업 브랜치 `yemo-develop`에 커밋 → `git push -u origin yemo-develop`.
- `main` 직접 push 금지.
- 커밋 author/committer는 `Claude <noreply@anthropic.com>`로 맞춰야 GitHub Verified 표시됨
  (필요 시 `git config user.email noreply@anthropic.com && git config user.name Claude`
  후 `git commit --amend --no-edit --reset-author`).
- PR은 명시 요청 전까지 만들지 않는다.
