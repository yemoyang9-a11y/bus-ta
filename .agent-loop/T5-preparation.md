# T5 사전 조사 — 2026-09-23

상태: **준비 완료, Director의 T4 편집 종료/구현 허용 통보 대기.** 이 단계에서는 앱·shared·package·CI·lint 설정을 수정하거나 의존성을 설치하지 않았다. 이 준비 문서만 작성했다. T2 P2는 다른 구현자 소유다.

## 구체 변경안

1. root `packageManager: pnpm@11.7.0`은 유지. 실제 `%LOCALAPPDATA%/node/corepack/v1/pnpm/11.7.0/package.json`의 engines.node=`>=22.13`을 재확인했다. root engines.node를 `>=22.13.0`, pnpm은 현재 고정 주 버전에 맞춰 `>=11.7.0`으로 정리한다. CI/Render의22.17.0은 그대로 충족하며, 로컬 실행24.15.0을22실행으로 주장하지 않는다.
2. server rootDir=`../..`, outDir=`dist`. `pnpm build`로 실물 파일을 확인한 뒤 `main`을 `./dist/apps/server/src/index.js`로 고친다. start=`tsx src/index.ts`는 유지하고 compiled main을 독립 실행 번들이라고 주장하지 않는다.
3. `packages/shared/src/constants/realtime.ts`에 `HANEUM_REALTIME_MODEL`과 `REALTIME_SHARED_SECRET_HEADER`를 둔다. shared index에서 export. mobile guide/server config의 기존 모델 export는 호환 re-export로 유지하며 client의 computed header와 server req.header가 같은 상수를 사용한다. TTL600·모델값·인증 실패 정책은 그대로 둔다. T4가 guide/index를 수정하므로 구현 시작 때 다시 읽고 최소 patch한다. 관련 실제 소비자/라우트 회귀로 값 연결을 확인한다.
4. root `eslint.config.mjs`의 flat config로 apps/packages/scripts TS/JS/JSX/MJS를 검사한다. 오류 중심 기본 규칙(`no-undef`는JS만, 중복키/분기/인수, 잘못된 typeof, unsafe finally, unexpected multiline 등)과 TypeScript parser/plugin을 등록한다. 사용하지 않은 변수/any/포맷/스타일 전체 강제는 하지 않는다. TS의 no-undef는 TypeScript typecheck에 맡긴다. 기존 `@typescript-eslint/no-explicit-any` disable 주석은 plugin을 등록하고 해당 규칙을 강제하지 않아 unknown-rule 에러를 피한다. unused-disable 보고도 도입 때 불필요한 대량 수정이 나지 않도록 끈다.
5. root `lint`를 실제 ESLint 실행으로 연결한다. 파일별 환경은 Node(server/scripts/build config), React Native/mobile browser-like globals 및 __DEV__ 등 실제 사용 범위로 구분한다. node_modules/dist/.agent-loop/.worktrees 같은 산출물은 제외한다. JSX parserOptions.jsx를 켜되 React 스타일 규칙 전체를 추가하지 않는다. 의도적으로 미정의 JS 식별자와 잘못된 JSX/TS 구문을 stdin으로 넣어 lint가 실제 실패하는 smoke도 실행한다.
6. CI 첫 job에 lint/build 및 전체 scripts의 `.test.mjs`와 `.test.ts`를 tsx로 실행하는 명령을 추가한다. 현재 server 패키지의 tsx를 사용해 `pnpm --filter @bus-ta/server exec tsx --test "../../scripts/*.test.mjs" "../../scripts/*.test.ts"`를 먼저 검증한다. 새 runner가 불필요하면 만들지 않는다. C++ replay는 `node scripts/test-cane-feedback.mjs`(Ubuntu g++ 자동 탐지). 서버 현재 시험은 유지한다.
7. SQL job에 Node22.17.0을 명시하고 기존 boarding script로 migration 적용 후 `node scripts/test-bell-result-sql.mjs`를 실행한다. PGHOST/PORT/USER/PASSWORD/PGDATABASE는 해당 격리 postgres 서비스로 고정한다. 기존 script의 fresh service_role 생성만 `nologin bypassrls`로 맞춘다. 원격/운영 role이나 migration의 SECURITY INVOKER를 바꾸지 않는다. 새 bell runner는 로컬호스트만 허용하고 실제 별도 연결 경합을 실행한다.
8. scripts/README는 실제 명령·대상·DB 전제조건·host C++/ESP32 차이·CI 포함 범위를 업데이트한다. 앱 번들 및 최종 전체 suite는 T7 소유다.

## 도구 버전/공식 출처

2026-09-23 공식 npm registry latest metadata를 읽기 전용으로 조회했다(출력 chunk ef720f). 설치 후보는 **정확한 버전 고정**이며 필요한 lint 의존성 외 업그레이드는 하지 않는다.

| 패키지 | 확인 버전 | 호환 조건 |
|---|---|---|
| eslint | 10.11.0 | Node ^20.19.0 또는 ^22.13.0 또는 >=24 |
| typescript-eslint | 8.70.1 | ESLint ^8.57/^9/^10, TypeScript >=4.8.4 <6.1.0 |
| globals | 17.12.0 | Node >=18 |
| @eslint/js | 10.0.1 | ESLint ^10, 필요 시 추천 규칙 원본 용도로만 사용; 수동 최소 규칙이면 설치 불필요 |

- registry: `https://registry.npmjs.org/eslint/latest`, `https://registry.npmjs.org/typescript-eslint/latest`, `https://registry.npmjs.org/globals/latest`, `https://registry.npmjs.org/%40eslint%2Fjs/latest`.
- [ESLint language options](https://eslint.org/docs/latest/use/configure/language-options): JSX 구문·파일별 globals/sourceType 설정 근거.
- [ESLint flat configuration](https://eslint.org/docs/latest/use/configure/configuration-files): 범위/ignore/설정 근거.
- [typescript-eslint no-undef FAQ](https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors): TS에서는 core no-undef 대신 TS 검사를 권고하며 JS/TS 혼합 프로젝트에서TS만 해제할 수 있다.
- [Supabase Postgres roles](https://supabase.com/docs/guides/database/postgres/roles): service_role과 RLS 역할 의미 확인. Supabase skill을 읽었다. changelog.md는 도구 content-type 오류여서 [HTML changelog](https://supabase.com/changelog)로 대조했다. 이번 작업은 로컬 CI fixture 구성이고 플랫폼 기능 변경은 없다.

## 잠재 차단/재개 시 확인

- T4 guide/shared/index 수정과 충돌하면 안 된다. 통보 전 편집 금지. 현재 application 소스 snapshot은 T4/T2 작업 중이므로 lint/typecheck/build를 최종 결과로 실행하지 않았다.
- JSX no-undef는 일반 JS 이름 검사를 제공하며 React 전용 분석 전체를 주장하지 않는다. 기존 스타일 경고를 대량 수정하는 구성을 피한다.
- `.mjs` 시험들이 `.ts`를 직접 import하므로 일반 node --test만 CI에 넣으면 Node22와24차이가 드러날 수 있다. tsx 경로를 사용하고 Windows/Linux glob 처리를 실제 확인한다.
- 현재 Supabase boarding shell은 로컬 bash/psql 환경이 필요하며 fixture DB를 만들고 제거한다. CI는 fresh postgres서비스, 로컬은 Director가 마련한 작업용 PG55439만 사용한다. 실제 Linux CI 실행은 아직 하지 않았다.
- 새 lint 설치는 네트워크 및 frozen lock 재검증이 필요하다. 린트가 실제 오류를 찾으면 안전한 최소 수정만 하고 T2/T4 소유파일 문제는 담당자와 조율한다.
- 허용 변경 완료 후 `pnpm lint`, `pnpm -r typecheck`, `pnpm build`/main산출물 확인, 관련 Realtime/전체scripts 시험, C++ replay, 변경된 SQL CI 경로에 대응하는 로컬 SQL 검증을 기록한다. 최종 `.agent-loop/T5-implementation.md`는 구현 뒤 작성한다. 커밋·푸시·운영 변경 금지.
