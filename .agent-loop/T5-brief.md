# T5 실행 및 품질 검사 인계

계획 T5. T4 완료 뒤 실행. 허용 root/server/mobile/shared package.json, 잠금파일(필요한 lint 의존성만), lint config, CI, Realtime 상수와 실제 소비자 및 관련 시험, scripts/README.md. 불필요한 전체 포맷 변경 금지.

1. packageManager pnpm@11.7.0 유지. root engines node>=20/pnpm>=9는 오래된 선언. CI와 render는 이미 Node22.17.0. 설치 pnpm의 실제 engines 또는 공식 릴리스에서 >=22.13 요구 확인 후 일치시킨다. 시스템은 Node24.15.0이므로 이번 실행을 Node22 실행으로 주장하지 않는다.

   Director가 실제 Corepack 캐시 `%LOCALAPPDATA%/node/corepack/v1/pnpm/11.7.0/package.json`을 읽어 name=pnpm, version=11.7.0, engines.node=">=22.13"을 확인했다. root engines.node는 이 최소값에 맞춘다. CI/Render22.17.0은 이를 충족한다.
2. server tsconfig rootDir ../.., outDir dist. 실제 build 산출물 확인 후 main을 dist/apps/server/src/index.js로 맞춘다. start는 tsx 현재 지원 경로이므로 start 명령이나 Docker/Render가 임의로 바뀌지 않아야 한다. compiled main이 실행 가능한 배포 번들이라는 추가 주장도 하지 않는다(shared TS 참조 존재).
3. HANEUM_REALTIME_MODEL이 apps/mobile/src/realtime/guide.ts 및 server services/realtime/config.ts에서 중복. 헤더 x-realtime-shared-secret도 client.ts/routes/realtime.ts에 반복. packages/shared/constants에서 단일 출처로 제공하고 공개 exports 연결. 기존 guide/config의 import API는 호환 re-export 등 최소 변경. tests는 소비자 actual values 연결 확인; 원래 모델값/TTL/인증정책 변경 없음.
4. root lint 현재 하위 script 없음. 실제 TS/JS/JSX를 파싱하며 미정의 변수/잘못된 구문 등 유의미한 문제를 찾는 최소 lint 도구를 설치·고정하고 pnpm lint/CI에 연결. 기존 스타일 전부 바꾸거나 대량 unused/no-explicit-any 규칙 강제하지 않는다. ts compiler가 보는 TS와 JS/JSX 환경 globals 차이 고려. eslint disable 주석의 unknown rule 오류가 생기지 않게 관련 parser/plugin 설정. 정책상 새 도구 현재 문서는 공식 primary source로만 확인한다. lint에 필요한 범위 외 의존성 업그레이드 금지.
5. scripts README에 C++ replay와 추가된 SQL/모바일/스크립트 실행 안내, CI coverage를 실제와 일치시킨다. CI에 전체 별도 scripts 시험도 포함하면 현재 T2에서 고친 stale 테스트가 재발하지 않는다. 펌웨어 host test는 g++ 있는 Linux에서 runner 자동 탐지 가능. 실제 ESP32 빌드 환경은 README 경로를 따른다.

CI SQL 연결 시 주의: 기존 scripts/test-supabase-boarding.sh는 service_role을 nologin만으로 생성하며 Supabase의 BYPASSRLS 속성을 재현하지 않는다. T3의 새 SQL은 실제 SET ROLE service_role로 검증하므로 전용 CI PostgreSQL fixture role을 만들 때 `create role service_role nologin bypassrls`로 Supabase 역할 의미를 맞춘다. 운영 역할 변경/SECURITY DEFINER 전환으로 우회하지 않는다. 현재 작업용 PG는 이미 BYPASSRLS인 역할로 시작했고 T3 시험은 해당 조건에서 실행됐다. CI Postgres job에 migration 후 `node scripts/test-bell-result-sql.mjs`를 연결하고 PG 환경/Node 버전을 명시한다. 새 runner는 별도세션4경합 및중간실패rollback·ACL을실행한다. 실제LinuxCI실행은로컬검증과구분한다.

검증: pnpm lint, pnpm -r typecheck, pnpm build 및 산출물, 관련 Realtime tests. 앱 번들/최종 전체 suite는 T7에서 수행. 보고 .agent-loop/T5-implementation.md. 커밋/푸시/배포 없음.
