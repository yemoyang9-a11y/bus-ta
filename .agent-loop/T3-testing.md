# T3 독립 시험 결과 (2026-09-22)

## 판정

**T3 범위 PASS — Reviewer 검토 가능.** 서비스·저장소 33개, 실제 PostgreSQL 원자성·권한 시험, 별도 세션 경합 4개, 기존 탑승 SQL, T3 범위 타입 검사와 보안 검사를 직접 다시 실행했다. 아래 범위에서 재현된 실패는 없다. 전체 애플리케이션 및 운영 배포 PASS를 뜻하지 않는다.

Tester는 애플리케이션·시험·migration 코드를 수정하지 않았다. 작성 파일은 이 보고서뿐이다. 기존 migration 11개와 신규 migration을 재적용하지 않았고 이미 준비된 로컬 DB에서 시험했다. 원본 checkout, 운영 DB, 커밋·푸시·배포는 건드리지 않았다.

## 대상과 변경 범위

작업 폴더: `C:\Users\yemoy\OneDrive\문서\한이음\.worktrees\rehearsal-20260922`.

`.agent-loop/T3-brief.md`, `T3-implementation.md`, 실행 계획 T3 및 관련 API/DB 문서를 기준으로 다음 변경을 읽었다. 다른 작업이 진행 중인 앱·펌웨어 변경은 이번 검증 범위에서 제외했다.

- 수정: `apps/server/src/services/trip/bell-result.service.ts`, `bell-result.service.test.ts`, `apps/server/src/repositories/supabase/trip.repository.ts`, `apps/server/src/demo/bell-demo.ts`.
- 신규: `apps/server/src/services/trip/bell-result.atomic.test.ts`, `supabase/migrations/20260922091013_atomic_bell_result.sql`, `supabase/tests/bell_result_atomicity.sql`, `scripts/test-bell-result-sql.mjs`.
- 함께 수정한 문서: `docs/API_SPEC.md`, `docs/DB_SCHEMA.md`. migration 선행 적용, 구 서버의 두 PATCH 경로가 남는 기간, 로컬 시험과 운영 적용 구분을 확인했다.
- 기존 `trip.repository.test.ts`는 이번 변경 파일은 아니지만 저장소 회귀 범위로 실행했다. `git diff --numstat -- supabase/migrations`는 출력이 없어 기존 tracked migration 수정이 없음을 확인했다. 신규 migration은 untracked 목록에서 확인했다.

## 직접 실행한 명령과 결과

단위 시험의 작업 위치는 `apps/server`, 나머지는 worktree 루트다. Windows 자식 프로세스 시험과 로컬 psql 실행에는 `require_escalated`를 사용했다. 이 재검증에서 환경 실패나 실행 중단은 없었다.

| 검증 | 실행 명령 | 결과 / 도구 출력 |
| --- | --- | --- |
| 서비스·저장소 범위 | `node node_modules/tsx/dist/cli.mjs --test src/services/trip/bell-result.service.test.ts src/services/trip/bell-result.atomic.test.ts src/repositories/supabase/trip.repository.test.ts` | **33 PASS / 0 FAIL**, exit 0 (`fcfb77`) |
| 실제 SQL 및 4개 경합 | 아래 PG 환경을 지정하고 `node scripts/test-bell-result-sql.mjs` | **PASS**, exit 0 (`9467b5`) |
| T3 범위 타입 검사 | `node node_modules/typescript/bin/tsc --noEmit -p .agent-loop/T3-typecheck.json` | **PASS**, exit 0, 진단 없음 (`dc9104`) |
| 보안 검사기 회귀 | `node --test scripts/verify-supabase-security.test.mjs` | **7 PASS / 0 FAIL**, exit 0 (`b363e7`) |
| migration 보안 검사 | `node scripts/verify-supabase-security.mjs` | `Supabase security verification passed.`, exit 0 (`1049fb`) |
| 기존 탑승 SQL | `Get-Content supabase/tests/boarding_confirmation_race.sql -Raw \| & $pgClient -X -d postgres -v ON_ERROR_STOP=1` | BEGIN, INSERT 2회, DO 3회, **ROLLBACK**, exit 0 (`364987`) |
| 시험 후 DB 확인 | psql stdin의 읽기 전용 버전·fixture·trigger·세션·RPC 권한 조회 | **PASS**, exit 0 (`3c2113`), 아래 실제 결과 |
| 공백 검사 | `git diff --check --` 뒤 위 T3 변경 파일 전체를 지정 | **PASS**, exit 0 (`1049fb`). tracked 파일 LF→CRLF 변환 예고만 존재 |

로컬 SQL 실행에 사용한 환경:

```powershell
$pgConfig = Get-Content .agent-loop/pg-env.json -Raw | ConvertFrom-Json
$env:PSQL_BIN = Join-Path $pgConfig.bin 'psql.exe'
$pgClient = $env:PSQL_BIN
$env:PGHOST='127.0.0.1'
$env:PGPORT='55439'
$env:PGUSER='postgres'
$env:PGDATABASE='postgres'
$env:PGCLIENTENCODING='UTF8'
$OutputEncoding=[System.Text.UTF8Encoding]::new($false)
node scripts/test-bell-result-sql.mjs
```

실제 SQL runner 출력:

```text
PASS: transactional SQL, rollback injection, retries, legacy repair and ACL
PASS: same (two PostgreSQL sessions; lock wait observed before commit)
PASS: conflicting (two PostgreSQL sessions; lock wait observed before commit)
PASS: cancel-first (two PostgreSQL sessions; lock wait observed before commit)
PASS: result-first (two PostgreSQL sessions; lock wait observed before commit)
PASS: all bell result SQL tests; task-only fixtures removed
```

## 완료조건별 확인

| 완료조건 | 확인한 증거 | 결과 |
| --- | --- | --- |
| 두 테이블 저장 원자성 | 실제 `trip_status` UPDATE 직전 trigger로 예외를 주입한다. 앞선 `bell_logs`의 result/completed_at/message/is_mock가 모두 초기값으로 복원되고 상태가 PENDING인지 SQL assertion으로 확인한다. | PASS |
| 최초 결과와 metadata 보존 | 같은 결과/상충 결과 재전송, 최초 FAIL 뒤 SUCCESS, legacy 일부 저장에 대한 실제 SQL. 최초 메시지·mock 여부·완료 시각 보존 및 상태 복구 확인. | PASS |
| 단일 RPC와 권위 있는 응답 | service+repository 결합 시험이 HTTP 호출 1회와 정확한 RPC payload를 확인. incoming FAIL 대신 먼저 저장된 SUCCESS와 잠금 당시 CANCELLED를 반환. 사전 조회·fallback PATCH 없음. | PASS |
| 공개 오류 계약 유지 | 400 INVALID_REQUEST, 404 BELL_REQUEST_NOT_FOUND, 409 INVALID_BELL_STATE, 500 DB_ERROR 시험. RPC HTTP 실패 원문 누출 없음. | PASS |
| RPC 응답 검증 | null/배열/문자열/빈 객체/필수 값 누락/잘못된 bellStatus·tripStatus/다른 tripId·bellRequestId를 거부한다. repository는 unknown 응답을 Zod로 검증한다. | PASS |
| 요청 소속 및 현재 요청 확인 | 존재하지 않는 운행, 다른 운행의 bellRequestId, NOT_REQUESTED, 더 오래된 요청, 잘못된 result의 실제 SQL. 옛 요청은 최신 상태를 수정하지 못한다. | PASS |
| 종료 운행 보존 | CANCELLED/TRIP_DONE 결과 저장 SQL, cancel-first/result-first 실제 경합. RPC는 trip_status.trip_status를 변경하지 않는다. | PASS |
| 잠금 순서 | migration에서 `trip_status FOR UPDATE` 후 최신 `bell_logs FOR UPDATE`. 아래 4개 다중 세션 시험이 실제 대기와 확정 결과를 확인. | PASS |
| DB 함수 권한 | SECURITY INVOKER·빈 search_path·public 테이블 참조·PUBLIC/anon/authenticated EXECUTE 회수·service_role 허용. 실제 anon 호출 거절 및 service_role 호출 성공. | PASS |
| 배포 선행 조건과 문서 | API_SPEC/DB_SCHEMA에 migration 먼저 적용, RPC 없으면 DB_ERROR, 모든 구 서버 교체 후에 전체 원자성 보장 가능, 운영 미적용을 명시. | 확인 |

## 동시성 시험이 실제 경합인지 확인

`scripts/test-bell-result-sql.mjs`를 직접 읽고 실행했다. 각 시나리오는 서로 다른 psql 자식 프로세스와 `PGAPPNAME`을 사용한다. 첫 세션이 BEGIN 및 RPC를 마치고 `T3_LOCK_HELD`를 출력해도 COMMIT은 보류한다. 그 뒤 두 번째 세션을 시작하고 별도 관측 연결이 `pg_stat_activity.wait_event_type = 'Lock'` 및 대상 application_name을 확인한다. 두 번째 출력이 아직 비어 있음을 assertion한 뒤 첫 세션을 COMMIT한다.

따라서 순차 RPC 호출이나 JavaScript Promise 경쟁만을 동시성 증거로 삼지 않는다. 두 세션은 실제 PostgreSQL에서 잠금을 놓고 경쟁했다.

- `same`: 첫 SUCCESS가 SAVED, 두 번째는 ALREADY_RECORDED. DB의 로그와 상태 모두 SUCCESS.
- `conflicting`: 먼저 SUCCESS, 대기 중 FAIL. 두 번째도 최초 SUCCESS를 반환하며 최초 metadata 유지.
- `cancel-first`: 먼저 취소가 잠금을 보유. 결과 저장은 취소 뒤 진행하며 응답과 DB의 CANCELLED를 보존.
- `result-first`: 먼저 결과 저장이 잠금을 보유. 취소는 결과 저장 뒤 진행하며 결과 SUCCESS와 최종 CANCELLED를 함께 보존.

경합 fixture는 실행기가 만든 UUID ID 4개만 정확히 삭제하고 잔존 0을 assertion한다. 단일 세션 SQL fixture 및 장애 주입 trigger는 BEGIN/ROLLBACK으로 정리한다.

## 독립 cleanup·실행 대상 확인

시험 종료 뒤 별도 읽기 전용 psql 조회 결과:

```json
{"serverPort":55439,"serverAddress":"127.0.0.1","serverVersion":"15.19"}
{"trips":0,"bellLogs":0,"tripStatus":0,"locationLogs":0,"raceSessions":0,"injectedTriggers":0}
{"settings":["search_path=\"\""],"anonExecute":false,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":false}
```

네 테이블의 잔존 조회 대상은 `t3-atomic-%`, `t3-race-%`, `trip-boarding-race-test`다. trigger는 `t3_fail_status_update`, 연결은 `application_name like 't3-race-%'`를 확인했다. 별도 삭제 명령은 추가 실행하지 않았으며 runner의 정리 결과를 독립 확인했다.

## 검증 한계와 남은 작업

- 전체 서버 suite/typecheck는 현재 T2 수정과 겹치므로 요청대로 반복하지 않았다. 구현 보고의 과거 전체 시험 393/400 및 typecheck 실패는 당시 T2 병렬 스냅샷이며 이번 Tester의 현재 전체 결과가 아니다. T2 종료 뒤 전체 통합 검증이 필요하다.
- `.agent-loop/T3-typecheck.json`은 T3 파일만 include하는 설정이다. 이 PASS를 전체 서버·모바일 타입 검사 PASS로 대체하지 않는다.
- 33개 TypeScript 시험의 HTTP는 stub이다. 실제 PostgreSQL 시험은 psql로 수행했으며 live Supabase PostgREST/API 왕복을 실행하지 않았다.
- 원격 Supabase migration 적용·Advisor·실제 배포·BLE Notify→앱→운영 API/DB는 미검증이다. 기존 migration을 다시 적용하거나 새 RPC를 운영 DB에 생성하지 않았다.
- 최초 RED 단계는 구현 보고를 읽었으나 Tester가 재실행하지 않았다. 기존 boarding legacy-preflight 별도 DB 시험도 재실행하지 않았다.
- Supabase 지침에 따라 [공식 Database Functions 문서](https://supabase.com/docs/guides/database/functions)의 함수 권한 기준을 확인했다. changelog Markdown 요청은 도구가 content-type을 지원하지 않아 읽지 못했다. 로컬 SQL/ACL 검증 결과와 이 문서 접근 한계를 구분한다.
