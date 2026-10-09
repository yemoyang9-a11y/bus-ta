# T5 구현 인계 — 2026-09-23

상태: **구현 완료, 소스 편집 동결. 독립 Tester/Reviewer 대기.** 커밋·푸시·배포·운영 DB 변경 없음. T4/T2 승인된 변경을 보존했다.

## 변경 범위

- `package.json`: packageManager pnpm@11.7.0 유지, engines Node >=22.13.0 / pnpm >=11.7.0. 실제 lint 및 전체 scripts/C++ 명령 추가. 최소 devDependencies eslint10.11.0, typescript-eslint8.70.1, globals17.12.0 정확한 버전 고정.
- `pnpm-lock.yaml`: 위 린트 의존성 그래프 추가. 기존 직접 의존성 버전 변경 없음. 기존 일부 optional 전이 의존성이 린트에서도 필요해 optional 플래그가 제거된 변경 포함.
- `eslint.config.mjs`: JS/JSX/TS 구문, 미정의 JS 변수, 중복 키/인수/분기, 잘못된 typeof, unsafe finally 등 오류 중심 검사. TS 이름 검사는 tsc에 맡긴다. 기존 any 허용 주석을 해석하도록 TS plugin 등록. 포맷/unused/any 일괄 강제 없음.
- `apps/server/package.json`: 실제 산출물 확인 후 main=`./dist/apps/server/src/index.js`. start=`tsx src/index.ts` 유지.
- `packages/shared/src/constants/realtime.ts`, `packages/shared/src/index.ts`: 모델과 인증 헤더 단일 출처 및 공개 export.
- `apps/mobile/src/realtime/guide.ts`, `apps/server/src/services/realtime/config.ts`: 기존 모델 import API를 호환 re-export로 유지. `apps/mobile/src/api/client.ts`, `apps/server/src/routes/realtime.ts`: 실제 요청/수신에 공통 헤더 사용. 모델값 gpt-realtime-mini, TTL600, 인증 정책 그대로.
- `scripts/realtime-contract.test.ts`: 실제 모델 소비자와 모바일 fetch 헤더/시크릿 생략 회귀 2개.
- `.github/workflows/ci.yml`: lint/build/전체 scripts/C++ host 연결, SQL job Node22.17.0 및 PG 환경 명시, boarding 이후 bell SQL runner 연결.
- `scripts/test-supabase-boarding.sh`: fresh CI service_role만 NOLOGIN BYPASSRLS로 생성. 기존 역할 수정 및 migration 변경 없음.
- `scripts/README.md`: 실제 실행 명령, SQL 폐기용 인스턴스 전제, host/실물·빌드/배포 경계, CI coverage.

설정 선택의 공식 근거와 도구 호환 버전은 `T5-preparation.md`의 링크를 따른다. 문서 범위는 scripts README만 수정했다.

## 실제 실행과 결과

모든 명령의 cwd는 이 worktree 루트다. 로컬 Node **v24.15.0**, pnpm **11.7.0**이며 Node22 실행으로 주장하지 않는다.

| 명령 | 결과 | 로그 |
|---|---|---|
| `pnpm --filter @bus-ta/server exec tsx --test ../../scripts/realtime-contract.test.ts` (구현 전) | RED: 2개 모두 shared export undefined로 예상 실패, exit1 | 도구 출력 chunk c09e7d |
| `pnpm add -DwE eslint@10.11.0 typescript-eslint@8.70.1 globals@17.12.0` | exit0, 네트워크 재시도 후 설치 | 도구 출력 0b751a |
| `pnpm install --frozen-lockfile --offline` | PASS exit0, lock 최신/재해석 없음 | T5-frozen-install.log |
| `pnpm lint` | PASS exit0 | T5-lint.log |
| ESLint API `lintText` 4개 입력 smoke | 미정의 JS, 잘못된 JSX, 잘못된 TS 모두 거부; 정의된 컴포넌트의 정상 JSX 허용 | T5-lint-smoke.log |
| `pnpm -r typecheck` | shared/server/mobile PASS exit0 | T5-typecheck.log |
| `pnpm build`, package main 경로 Get-Item | PASS exit0, 실제 index.js 1825 bytes | T5-build.log |
| `pnpm test:scripts` | GREEN **68/68 PASS**, 새 계약2개 포함, exit0 | T5-scripts.log |
| `pnpm --filter @bus-ta/server exec tsx --test src/routes/realtime.test.ts src/services/realtime/*.test.ts` | **12/12 PASS**, 실제 라우트 인증 성공/거부·모델·TTL 회귀, exit0 | T5-realtime.log |
| `pnpm test:cane` | **19 PASS**, 실제 C++ compile/run exit0 | T5-cane.log |
| `git diff --check` 및 T5 범위 재확인 | PASS; CRLF 변환 예고만 있음 | 도구 출력 |

lint smoke 최초 정상 입력에서 View를 선언하지 않아 no-undef가 정확히 거부했다. 정상 fixture에 View 선언을 추가한 뒤 4개 검증 PASS. 애플리케이션 소스를 우회 수정하지 않았다.

`pnpm peers check`는 기존 React Native0.81.5의 @types/react ^19.1.0 요구와 설치18.3.31의 불일치 경고를 보고했다(T5-peers.log). T5에서 React 의존성은 수정하지 않았고 lint/typecheck/build는 통과했다. 설치의 deprecated 전이 의존성 경고도 이번 범위에서 업그레이드하지 않았다.

## 실제 로컬 PostgreSQL 검증

첫 55439 접속은 중지된 작업용 DB 때문에 connection refused. `.agent-loop/pg-env.json` 경로를 확인하고 Director 허용 아래 기존 작업 cluster를 재시작했다. 경로는 `C:/Users/yemoy/AppData/Local/Temp/bus-ta-rehearsal-20260922/data`, host127.0.0.1, port55439다. 자동 crash recovery 후 ready 확인. 재실행은 PASS(T5-sql.log); 실패를 제품 결함으로 처리하지 않았다. 이 기존 cluster는 다음 검증을 위해 실행 중이다.

fresh role 생성/전체 CI 순서를 검증하려고 같은 작업 전용 ASCII 디렉터리 아래 별도 `T5-ci/data` cluster를 initdb(UTF8, postgres, trust)로 만들었다. 127.0.0.1:55440만 사용했으며 검사 완료 후 pg_ctl fast stop으로 **정상 종료**했다. 파일은 재검증을 위해 보존했다. 기존/운영 인스턴스는 수정하지 않았다.

PowerShell의 재현 명령(새 cluster 초기화 완료/시작 상태 기준):

```powershell
$pgConfig = Get-Content .agent-loop/pg-env.json -Raw | ConvertFrom-Json
$env:PATH = $pgConfig.bin + ';' + $env:PATH
$env:PSQL_BIN = Join-Path $pgConfig.bin 'psql.exe'
$env:PGHOST = '127.0.0.1'
$env:PGPORT = '55440'
$env:PGUSER = 'postgres'
$env:PGPASSWORD = 'postgres'
$env:PGDATABASE = 'postgres'
& 'C:/Program Files/Git/bin/bash.exe' scripts/test-supabase-boarding.sh
node scripts/test-bell-result-sql.mjs
```

- fresh CI shell 전체 migration/boarding/legacy 사전조건: PASS exit0, `T5-ci-boarding.log`.
- 생성 role 실조회: `service_role | rolcanlogin=f | rolbypassrls=t`, `T5-ci-role.log`.
- 후속 bell SQL: transaction/rollback 주입/retry/legacy/ACL PASS, 별도 세션 lock 대기를 관측한 same/conflicting/cancel-first/result-first **4/4 PASS**, exit0. `T5-ci-bell.log`.
- runner가 자체 bell fixtures 제거를 확인했다. legacy 사전조건 DB는 종료한 폐기용 cluster 내부에만 남는다.
- 초기화 로그 `T5-ci-init.log`, DB 서버 로그는 작업 temp `T5-ci/postgres.log`.

## 검증 경계와 후속

- Git Bash + Windows PostgreSQL15.19/Node24에서 CI 명령 경로를 실행했다. 실제 Ubuntu GitHub Actions/Node22.17 실행은 아직 하지 않았다.
- compiled main은 파일 경로 정합성 확인이다. 공유 TS 참조가 남아 단독 실행 번들이라고 주장하지 않는다.
- 전체 서버 suite·모바일 번들·최종 통합 리허설은 T7/독립 Tester 소유이며 여기서는 관련 Realtime 및 전체 scripts를 실행했다.
- ESLint는 최소 오류 게이트이며 모든 스타일/React 전용 규칙/TS type-aware lint를 제공한다고 주장하지 않는다.
- 실물 BLE/모터, 무선 MTU, 실제 Realtime 오디오/외부 API 및 배포 검증은 별도다.

## P2 보완 — scripts TypeScript 검사 누락

Reviewer 지적을 재현했다. ESLint에서 TS no-undef를 끈 것은 TypeScript가 검사한다는 전제인데 기존 `pnpm -r typecheck`는 root scripts를 포함하지 않았다. 임시 `scripts/__t5-typecheck-probe.ts`에 `export const probe = definitelyMissingT5;`를 넣어도 기존 `pnpm typecheck` exit0이었다. `T5-P2-red.log`에 재현을 기록했고 임시 파일은 finally에서 제거했다.

보완 범위는 다음으로 한정했다.

- 새 root `tsconfig.scripts.json`: `scripts/**/*.ts` include, noEmit, strict/noUncheckedIndexedAccess 유지. tsx로 실행하는 모바일/서버 혼합 import를 해석하도록 ESNext/Bundler, ES2022+DOM, TS 확장 import를 허용. 기존 서버 패키지의 명시적 @types/node 의존성 경로를 사용해 의존성/lock 추가 없음.
- root `typecheck:scripts`=`tsc --noEmit -p tsconfig.scripts.json`, root `typecheck`가 workspace 검사 뒤 해당 명령을 실행. CI가 동일한 `pnpm typecheck`를 호출하며 scripts 포함을 step명에 표시.
- `scripts/realtime-session.integration.test.ts`의 실제 fixture에서 누락된 필수 `routeCandidatesExpiresAt: null` 1줄 보완. 제품 소스 변경 없음.
- README와 scripts/README에서 통합 명령/단독 명령/검사 범위를 안내.

**설정 예외 근거:** base의 exactOptionalPropertyTypes=true를 그대로 적용한 첫 실행에서 모바일 `server-event.ts`의 optional code/clientEventId, `session.ts`의 optional 문자열 및 candidateIdsToMark, `webrtc-transport.ts`의 optional AbortSignal 때문에 4개 진단이 나왔다(`T5-P2-initial-check.log`). 이 import 그래프는 기존 Expo 모바일 설정에서 해당 옵션을 강제하지 않는다. 이번 요청은 scripts 검사 누락 수정이므로 모바일 구현을 재작성하지 않고 scripts 설정에만 exactOptionalPropertyTypes=false를 명시했다. workspace 서버/shared의 기존 설정은 바꾸지 않았고 미정의 이름 검사는 유지한다.

검증 결과:

| 명령/경계 | 결과 | 로그 |
|---|---|---|
| 임시 undefined probe + 기존 `pnpm typecheck` | 누락 RED 재현: exit0 | T5-P2-red.log |
| 동일 probe + 수정 후 `pnpm typecheck` | 의도한 거부 exit2, scripts probe TS2304 Cannot find name definitelyMissingT5 | T5-P2-probe-rejected.log |
| probe 제거 후 `pnpm typecheck` | workspace+scripts GREEN exit0 | T5-P2-typecheck.log |
| `pnpm exec tsc -p tsconfig.scripts.json --showConfig` | realtime-completion.test.ts / realtime-contract.test.ts / realtime-session.integration.test.ts 정확히3개 root input 포함 확인 | T5-P2-show-config.json |
| `pnpm lint` | PASS exit0 | T5-P2-lint.log |
| `pnpm test:scripts` | 68/68 PASS exit0 | T5-P2-scripts.log |

CI는 로컬에서 검증한 통합 root 명령에 연결했다. 실제 GitHub Actions 실행으로 주장하지 않는다. probe 잔존 없음, 제품 코드/lock/auth/DB 변경 없음. P2 보완 후 다시 소스 편집 동결하며 독립 재검토를 요청한다.
