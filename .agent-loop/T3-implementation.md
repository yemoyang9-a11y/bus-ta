# T3 구현 인계 — 하차벨 결과 원자 저장

작성일: 2026-09-22. 작업 위치: `C:\Users\yemoy\OneDrive\문서\한이음\.worktrees\rehearsal-20260922`.
상태: T3 구현·담당자 검증 완료, 독립 Tester → Reviewer → Director 확인 대기.

## 변경 파일

1. `apps/server/src/services/trip/bell-result.service.ts`: 사전 조회/분리 reconcile 제거. 단일 저장 결과의 outcome, 최초 bellStatus, 잠금 당시 tripStatus로 공개 응답을 구성한다. 기존 200/400/404/409/500 및 오류 코드를 보존한다.
2. `apps/server/src/repositories/supabase/trip.repository.ts`: `record_bell_result` 한 번 호출. JSON을 unknown으로 받아 Zod로 outcome·enum·필수 필드와 요청 식별자 일치를 검증한다. 두 PATCH 및 외부 reconcile 구현을 제거했다.
3. `apps/server/src/services/trip/bell-result.service.test.ts`: 변경된 내부 저장 계약에 맞춘 SUCCESS/FAIL, metadata, 최초 결과 우선, 취소 상태 응답, 400/404/409/500 회귀시험.
4. `apps/server/src/services/trip/bell-result.atomic.test.ts` (신규): 실제 service+repository 경로에서 단일 RPC, 정확한 payload, 최초 결과/종료 상태, unknown/잘못된 enum/식별자 오류, HTTP 실패와 fallback PATCH 부재 검증.
5. `apps/server/src/demo/bell-demo.ts`: 인메모리 저장소와 서비스 호출을 새 내부 인터페이스에 맞춤. 데모 스크립트의 다른 동작은 변경하지 않았으며 실기기/운영 DB 데모를 실행하지 않았다.
6. `supabase/migrations/20260922091013_atomic_bell_result.sql` (신규): 설치된 CLI 2.108.0의 `migration new atomic_bell_result`로 생성.
7. `supabase/tests/bell_result_atomicity.sql` (신규): BEGIN/ROLLBACK fixture, 중간 실패·멱등·상충·legacy 복구·종료·잘못된 요청·ACL 실제 SQL.
8. `scripts/test-bell-result-sql.mjs` (신규): 위 SQL 및 실제 PostgreSQL 별도 세션 경합 실행기. loopback host만 허용, psql stdin UTF-8, Windows 창 숨김, 정확한 생성 fixture ID만 cleanup.
9. `docs/API_SPEC.md`, `docs/DB_SCHEMA.md`: 기존 공개 계약의 멱등 예외·원자 저장·권한·검증 명령·migration 선행 조건 명시.

원본 폴더, apps/mobile, integration/mobile*, Realtime scripts, firmware, 기존 migration은 수정하지 않았다. 커밋·푸시·배포·원격 DB 변경 없음. 공통 계획 체크박스는 다른 단계와 경합을 피하려고 수정하지 않았다.

## DB 동작

- 입력 result는 SUCCESS/FAIL만 허용하고 필수 인수 null/빈 식별자를 거부한다.
- 기존 위치/탑승확정/취소와 같은 순서: `trip_status FOR UPDATE` → 해당 운행의 최신 `bell_logs FOR UPDATE`.
- 운행/요청이 없거나 다른 운행의 요청이면 BELL_REQUEST_NOT_FOUND, 존재하지만 현재 요청이 아닌 과거 요청이면 INVALID_BELL_STATE. 현재 요청의 첫 결과는 bellStatus=PENDING일 때만 기록한다.
- 첫 트랜잭션만 로그 result/message/is_mock/completed_at을 확정한다. 동일/상충 재전송 모두 최초 결과와 metadata를 보존한다.
- `bell_logs` UPDATE와 `trip_status.bell_status` UPDATE가 함께 성공하거나 함께 rollback한다. 과거 첫 PATCH만 저장된 legacy 기록은 원래 결과를 보존해 bellStatus를 같은 트랜잭션에서 복구한다.
- trip_status.trip_status를 수정하지 않으므로 CANCELLED/TRIP_DONE을 회귀시키지 않는다. updated_at도 과거로 되돌리지 않는다.
- SECURITY INVOKER, 빈 search_path, public 테이블 한정 참조, PUBLIC/anon/authenticated EXECUTE 회수 및 service_role EXECUTE만 부여.
- 설계 참고: https://supabase.com/docs/guides/database/functions (invoker·search_path·함수 실행 권한).

## 실행 환경과 재현

로컬 전용 PostgreSQL 15.19: `127.0.0.1:55439`, user `postgres`, DB `postgres`. `.agent-loop/pg-env.json`의 bin 경로를 사용한다. 기존 11개 migration 적용 DB에 새 migration만 적용했다. Docker 오류는 수정/초기화하지 않았다. 이 검증은 실제 PostgreSQL 의미 검증이며 원격 Supabase Advisor, PostgREST, 배포 환경 증명은 아니다.

PowerShell, worktree 루트에서:

```powershell
$pgConfig = Get-Content .agent-loop/pg-env.json -Raw | ConvertFrom-Json
$env:PSQL_BIN = Join-Path $pgConfig.bin 'psql.exe'
$env:PGHOST='127.0.0.1'
$env:PGPORT='55439'
$env:PGUSER='postgres'
$env:PGCLIENTENCODING='UTF8'
$OutputEncoding=[System.Text.UTF8Encoding]::new($false)
Get-Content supabase/migrations/20260922091013_atomic_bell_result.sql -Raw | & $env:PSQL_BIN -X -d postgres -v ON_ERROR_STOP=1
node scripts/test-bell-result-sql.mjs
Get-Content supabase/tests/boarding_confirmation_race.sql -Raw | & $env:PSQL_BIN -X -d postgres -v ON_ERROR_STOP=1
```

Node 검사(`apps/server`에서):

```powershell
node node_modules/tsx/dist/cli.mjs --test src/services/trip/bell-result.service.test.ts src/services/trip/bell-result.atomic.test.ts src/repositories/supabase/trip.repository.test.ts
node node_modules/tsx/dist/cli.mjs --test 'src/**/*.test.ts'
```

루트의 검사:

```powershell
node node_modules/typescript/bin/tsc --noEmit -p .agent-loop/T3-typecheck.json
node node_modules/typescript/bin/tsc --noEmit -p apps/server/tsconfig.json
node --test scripts/verify-supabase-security.test.mjs
node scripts/verify-supabase-security.mjs
git diff --check
```

`.agent-loop/T3-typecheck.json`은 기존 서버 tsconfig를 상속하고 T3 파일 및 node 타입을 지정하는 임시 검증 설정이다. 범위를 좁힌 검사는 전체 typecheck 대체 증거가 아니다.

## 결과와 로그

- RED: `.agent-loop/T3-red-service.log`: 새 service+repository 시험 10개가 기존 구현에서 실패(사전 조회로 404 반환). `.agent-loop/T3-red-sql.log`: 기존 DB에서 `atomic bell result RPC is missing` 예상 실패. 그 전에 tsx shim 미인식 및 sandbox 자식 프로세스 EPERM 시도는 제품 실패로 세지 않았다.
- 최종 관련 단위/경계 시험: **33/33 PASS**, exit 0. `.agent-loop/T3-unit.log`.
- migration 적용: **PASS**, exit 0. `.agent-loop/T3-migration.log`.
- 실제 SQL: **PASS**, exit 0. `.agent-loop/T3-sql.log`. 두 번째 UPDATE trigger 장애 주입 후 로그 result/completed_at/message/is_mock와 상태 PENDING 전체 rollback, 동일/상충 replay, 최초 FAIL 보존, legacy metadata 보존+복구, 취소/완료 유지, 없는/타운행/옛 요청, 잘못된 result, invoker/search_path/ACL 및 실제 anon 거부/service_role 실행 확인.
- 실제 다중 세션: **4/4 PASS**, exit 0. `.agent-loop/T3-concurrency.log`. 동일 결과, 상충 결과, 취소 먼저, 결과 먼저. 첫 트랜잭션이 lock을 가진 상태에서 두 번째 psql 세션의 pg_stat_activity.wait_event_type=Lock을 확인한 뒤 commit. DB 양쪽 결과와 최초 metadata, 취소 상태를 검증했다. 순차 호출을 동시성 시험으로 간주하지 않았다. UUID로 생성한 정확한 fixture들을 삭제하고 잔존 0 확인.
- 기존 boarding SQL 회귀: **PASS**, exit 0. `.agent-loop/T3-boarding-regression.log`. `boarding_confirmation_race.sql` 재실행. legacy-preflight 별도 DB 시험은 이번 T3에서 재실행하지 않았다(기존 migration 수정 없음).
- Supabase 보안 검사: **7/7 PASS** 및 audit **PASS**, exit 0. `.agent-loop/T3-security-tests.log`, `.agent-loop/T3-security-audit.log`.
- T3 범위 typecheck: **PASS**, exit 0. `.agent-loop/T3-scoped-typecheck.log`.
- 전체 서버 시험: **400개 중 393 PASS / 7 FAIL**, exit 1. `.agent-loop/T3-server-suite.log`. T2 병렬 변경 중 스냅샷이며 실패는 `mobile-alight-bell-lifecycle` 2개, `mobile-function-dispatcher` explicit voice 1개, `mobile-riding-bell-lifecycle` 4개. 새 trip-tracking import를 기존 VM mock이 모르는 경우 등이 있다. 실패 시험명을 로그에 보존했으며 T2/Director에게 전달했다. T2 영역은 수정하지 않았다.
- 전체 서버 typecheck: **실패**, exit 2. `.agent-loop/T3-typecheck.log`. T3 자체 오류 수정 후 다시 확인했을 때 T3 파일 오류 없음. mobile session/runtime/AbortSignal 타입, T2 automatic-boarding/trip-tracking fixture 타입, 모바일 타입 유입 영향의 기존 route adapter timer 타입 오류 등이 남았다. T2 완료 후 독립 Tester가 전체 typecheck를 재실행해야 한다.
- `git diff --check`: **PASS**, exit 0. CRLF 변환 예고만 있었으며 공백 오류 없음.

## 배포 선행 조건과 제한

1. 사용자 승인된 별도 배포에서 migration을 먼저 적용하고 RPC/권한을 확인한 다음 서버를 교체한다. 이번 작업은 원격 적용하지 않았다.
2. 구 서버는 여전히 두 PATCH를 쓰므로 모든 서버 인스턴스 교체 전에는 전체 요청의 원자성 보장을 주장하지 않는다. 새 서버는 RPC 누락 시 DB_ERROR이며 구 저장 방식으로 fallback하지 않는다.
3. 실제 BLE Notify→앱→운영 API→운영 DB 흐름, 실기기와 배포 검증은 별도로 남는다.
4. 독립 Tester/Reviewer에게 이 파일과 T3-*.log를 넘긴다. T2 완료 전 전체 suite를 반복하지 않는다.
