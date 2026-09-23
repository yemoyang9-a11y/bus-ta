# T5 독립 검토 — 2026-09-23

## 판정

- **명세 충족: APPROVE**
- **코드 품질: REJECT** — P2 품질 게이트 공백 1건

T5 brief, 구현 보고, 독립 시험 보고와 T5 범위의 tracked/new 파일을 직접 대조했다. Node/pnpm 선언, 서버 `main`, Realtime 공통 상수와 기존 인증 정책, CI 작업 연결, PostgreSQL fixture 역할과 boarding→bell 실행 순서에는 차단 결함을 찾지 못했다. 다만 새 lint/typecheck 설명과 실제 검사 범위가 어긋나 `scripts/*.test.ts`의 미정의 이름·타입 오류가 CI를 통과할 수 있다.

## 발견 사항

### [P2] scripts TypeScript는 lint와 typecheck 양쪽에서 의미 검사가 빠진다

**위치:** `eslint.config.mjs:33-36`, `package.json:12-15`, `apps/server/tsconfig.json:9`, `packages/shared/tsconfig.json:7`, `scripts/README.md:19`

`eslint.config.mjs`는 모든 `*.ts`/`*.tsx`에 core `no-undef`를 끈다. 이는 TypeScript 파일에는 일반적으로 맞는 선택이지만, 대체 검사인 `pnpm -r typecheck`는 shared/server/mobile workspace의 TypeScript 설정만 실행한다. server와 shared는 각각 `src`만 include하고, mobile도 앱 디렉터리 밖의 루트 `scripts/`를 포함하지 않는다. 현재 `scripts/realtime-completion.test.ts`, `scripts/realtime-contract.test.ts`, `scripts/realtime-session.integration.test.ts`는 `tsx --test`로 변환·실행될 뿐 `tsc --noEmit` 대상이 아니다.

집중 재현으로 ESLint API에 파일 경로 `scripts/probe.ts`, 내용 `export function latent(){ return definitelyMissing; }`를 전달했을 때 **errorCount=0**이었다. 이 함수가 실행되지 않는 분기에 있으면 `pnpm test:scripts`도 검출하지 못한다. 따라서 README의 “TS 이름·타입 검사는 별도 typecheck가 담당한다”는 설명과 CI 품질 게이트가 실제 범위보다 넓게 쓰였다. 구현자의 smoke도 TS에 대해서는 잘못된 **구문**만 확인했고 미정의 이름은 확인하지 않았다.

**수정 경계:** core `no-undef`를 TypeScript에 다시 켜기보다는, `scripts/*.test.ts`를 포함하는 전용 tsconfig/typecheck 명령을 추가해 root typecheck와 CI에 연결한다. 이후 잠재 함수의 미정의 이름과 명백한 타입 오류가 실패하는 회귀 probe를 둔다. 현재 production app/server/shared TypeScript는 기존 workspace typecheck가 검사하므로 이 지적은 scripts TypeScript 경계에 한정한다.

## 명세 및 구현 대조

- `package.json:5-9`의 `pnpm@11.7.0`, Node `>=22.13.0`, pnpm `>=11.7.0`은 확인된 pnpm engine과 맞고, `.github/workflows/ci.yml:21-31` 및 `render.yaml:16-17`의 Node22.17.0이 이를 충족한다. lock importer는 lint 직접 의존성만 추가했고 독립 Tester의 frozen/offline 설치가 통과했다.
- `apps/server/package.json:6-10`의 `main=./dist/apps/server/src/index.js`는 `apps/server/tsconfig.json:6-7`의 outDir/rootDir에서 만들어지는 실제 1825-byte 산출물과 맞는다. 기존 `tsx src/index.ts` start는 유지됐다. shared TS 참조가 남은 산출물을 독립 배포 번들로 주장하지 않은 경계도 정확하다.
- `packages/shared/src/constants/realtime.ts:1-2`가 모델명과 헤더명을 단일 출처로 제공하고 `packages/shared/src/index.ts:1-3`이 공개한다. mobile guide/server config의 호환 re-export와 `apps/mobile/src/api/client.ts:159-168`, `apps/server/src/routes/realtime.ts:9-28`의 실제 송수신 소비를 확인했다. secret 부재 시 헤더 생략, 서버 secret 미설정/불일치 시 동일 401, 모델 `gpt-realtime-mini`, TTL600 정책은 유지된다.
- `.github/workflows/ci.yml:30-53`은 install/typecheck/lint/build/server/boarding/scripts/C++ 순서를 연결한다. SQL job은 `:55-84`에서 PG15 환경과 Node22.17을 지정하고 boarding migration/race 뒤 bell runner를 실행한다.
- `scripts/test-supabase-boarding.sh:10-17`은 fresh `service_role`을 `NOLOGIN BYPASSRLS`로 만들고 전체 migration 후 boarding SQL을 실행한다. 중복 역할 예외만 삼키므로 기존 역할을 임의로 ALTER하지 않는다. `scripts/test-bell-result-sql.mjs:10-13`은 로컬 DB만 허용하고, `:61-62`에서 원자성/rollback/ACL SQL을 먼저 실행한 다음 `:64-107`에서 service_role로 두 실제 psql 세션의 lock wait와 4개 경합 결과를 검사하며, `:108-118`에서 태스크 fixture를 정리한다.
- 누적 working diff에는 T1-T4 변경이 함께 존재한다. T5 구현 보고에 열거된 hunk와 새 파일을 따로 대조했으며, T5 명목으로 제품 동작을 추가하거나 문서 범위를 확장한 변경은 찾지 못했다.

## 검증 근거와 한계

독립 Tester가 frozen/offline install, lint와 6개 probe, workspace typecheck, build/main 실조회, scripts 68/68, Realtime 12/12, C++ 19, 실제 PostgreSQL bell SQL과 4경합을 실행해 모두 통과했다고 기록했다. 나는 전체 묶음을 반복하지 않고 위 P2의 ESLint 재현만 집중 실행했다.

실제 GitHub Actions Ubuntu/Node22.17 실행, 빈 캐시 네트워크 설치, 모바일·ESP32 실물, 실제 Realtime 오디오/외부 API, 운영 DB와 배포는 검증되지 않았다. 이는 구현·시험 보고에도 구분되어 있으며 이번 P2 외의 승인 차단 사유로 보지 않는다.

## P2 보완 재검토 — 2026-09-23

- **명세 충족: APPROVE**
- **코드 품질: APPROVE**

기존 P2는 해결됐다. `tsconfig.scripts.json:1-13`이 `scripts/**/*.ts`를 별도 strict/noEmit 검사 대상으로 삼고, `package.json:12-13`의 root `typecheck`가 workspace 검사 뒤 이를 실행한다. `.github/workflows/ci.yml:33-34`도 우회 명령이 아니라 같은 root 명령을 사용한다. `exactOptionalPropertyTypes`만 scripts가 가져오는 Expo 모바일 그래프의 기존 설정에 맞춰 완화됐고 `strict`와 `noUncheckedIndexedAccess`는 base에서 유지된다.

구현 로그의 TS2304 거부와 정상 typecheck를 확인했고, 독립 Tester는 세 scripts TS 파일이 실제 input임을 `--showConfig`/`--listFilesOnly`로 확인한 뒤 호출되지 않는 잠재 함수의 미정의 이름(TS2304)과 기본 타입 불일치(TS2322)가 `pnpm typecheck` exit2를 내는 것을 재현했다. probe 제거 후 workspace+scripts typecheck, lint, scripts 68/68이 모두 통과했다. `scripts/realtime-session.integration.test.ts:23`의 `routeCandidatesExpiresAt: null`은 새 검사에서 드러난 필수 fixture 필드 보완이며 제품 동작 변경이 아니다.

실제 Ubuntu/Node22 GitHub Actions 실행은 여전히 미검증이지만, CI가 호출할 명령과 Node22.17/lock 계약은 앞선 검토와 이번 독립 시험으로 정합하다. T5 범위에 남은 차단 결함은 찾지 못했다.
