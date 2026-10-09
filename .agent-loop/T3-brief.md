# T3 하차벨 결과 원자성 인계

실행 계획 T3와 공통 제약을 따른다. 최신 실행 배정에 따라 T2 모바일과 병렬 진행하며 모바일 파일은 수정하지 않는다. 기존 코드의 공개 API 응답·오류 코드·첫 결과 우선 규칙은 유지한다.

## 원인과 범위

현재 `bell-result.service.ts`는 조회한 결과를 기준으로 분기하며 `trip.repository.ts`의 `saveBellResult`는 bell_logs, trip_status를 두 PATCH로 나눠 저장한다. 두 번째 실패 및 서로 다른 결과의 동시 요청에서 문제가 생긴다. RPC가 반환한 실제 최초 결과와 최신 tripStatus가 응답의 권위여야 한다. RPC 밖의 사전 조회 또는 reconcile PATCH만으로 원자성 해결을 주장하지 않는다.

관련 내부 인터페이스, demo/bell-demo.ts의 메모리 저장소, service/repository tests도 함께 갱신한다. 기존 유효성 오류 INVALID_REQUEST, 없는 요청 BELL_REQUEST_NOT_FOUND, 부적합 상태 INVALID_BELL_STATE, 저장 오류 DB_ERROR와 HTTP 상태를 유지한다. 종료/취소된 운행의 늦은 벨 결과를 기록하더라도 tripStatus를 되돌리지 않는다. 기존 일부 저장된 bell_logs 결과는 최초 결과를 보존하며 상태만 같은 트랜잭션 안에서 복구한다.

## DB 설계 요구

- 기존 위치/취소 RPC와 동일하게 trip_status 행을 먼저 FOR UPDATE 잠그고 bell_logs 행을 잠근다. 현재 요청/운행 일치와 상태를 잠금 안에서 확인한다.
- 최초 결과만 확정하고 중복 또는 상충 요청은 최초 결과를 반환한다. trip_status.trip_status 자체는 수정하지 않는다.
- SECURITY INVOKER, 빈 search_path, public 스키마 한정 참조, PUBLIC/anon/authenticated EXECUTE 제거, service_role만 허용한다.
- RPC 출력 shape를 repository에서 unknown으로 검증한다. 임의 문자열 cast로 성공을 가장하지 않는다.
- 기존 migration은 수정하지 않는다. 새 migration이 backend보다 먼저 적용되어야 함을 API_SPEC/DB_SCHEMA에 기록한다.

## 도구와 실제 SQL 검증

Supabase 스킬/최신 문서 확인됨. 설치 CLI 2.108.0은 `pnpm exec` 링크 대신 `node node_modules/supabase/dist/supabase.js`로 실행 가능. `migration new --help` 실제 확인 완료. 새 파일은 `node node_modules/supabase/dist/supabase.js migration new atomic_bell_result`로 먼저 생성한다. Windows telemetry 파일 접근 때문에 require_escalated가 필요할 수 있다. 운영 link/push는 금지.

작업 전용 PostgreSQL 15.19가 127.0.0.1:55439에서 실행 중이다. `.agent-loop/pg-env.json`에 bin/data 경로가 있다. 기존 migration 11개 적용 및 boarding SQL 성공. 외부 운영 DB가 아니다. psql에 한글 파일명을 직접 넘기면 인코딩 문제가 있으므로 UTF8 내용을 표준 입력으로 전달한다.

PowerShell 실행 예:
```
$pgConfig = Get-Content .agent-loop/pg-env.json -Raw | ConvertFrom-Json
$pgClient = Join-Path $pgConfig.bin 'psql.exe'
$env:PGHOST='127.0.0.1'; $env:PGPORT='55439'; $env:PGUSER='postgres'; $env:PGCLIENTENCODING='UTF8'
$OutputEncoding=[System.Text.UTF8Encoding]::new($false)
Get-Content <sqlfile> -Raw | & $pgClient -d postgres -v ON_ERROR_STOP=1
```

실제 시험: 두 번째 UPDATE 장애 주입 시 모두 rollback, 중복 동일/상충, 둘 이상의 별도 세션 동시 경쟁, 취소와 결과 경합, 종료 상태 보존, 과거 불일치 복구, 잘못된 요청/권한. 단순 순차 테스트를 동시성 시험이라고 부르지 않는다. SQL fixture는 BEGIN/ROLLBACK 또는 명시적 task-only fixture cleanup. 기존 boarding test 재검증, 서비스/repository 전체 관련 테스트와 typecheck. 로그 `.agent-loop/T3-*.log`, 보고 `.agent-loop/T3-implementation.md`.

환경 제약: Docker 엔진은 오류로 못 켰으며 이를 복구/초기화하지 않는다. 직접 PostgreSQL로 실제 SQL 의미를 확인한다. Supabase 원격 Advisor 및 PostgREST 배포 증명과는 구분한다.
