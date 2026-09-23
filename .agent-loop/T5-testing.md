# T5 독립 시험 — 2026-09-23

**PASS — 로컬 검증 범위.** T5 brief/implementation/계획과 동결된 변경을 확인했다. 작업 폴더는 `C:\Users\yemoy\OneDrive\문서\한이음\.worktrees\rehearsal-20260922`, 실제 환경은 **Windows / Node v24.15.0 / pnpm 11.7.0**이다.

## 직접 실행

모두 worktree root에서 실행했다. child process가 필요한 pnpm/C++/SQL은 승인된 `require_escalated`를 사용했다. 시험 출력은 성공 시 마지막 12줄만 표시하되 원래 `$LASTEXITCODE`를 보존했다.

| 명령/검사 | 결과 | 직접 출력 chunk |
| --- | --- | --- |
| `pnpm install --frozen-lockfile --offline` | exit 0, Already up to date | `bf60cb` |
| `pnpm lint` | exit 0, 실제 ESLint 실행 | `1a4eec` |
| ESLint `lintText` 메모리 probe 6개 | 결함 5개 거부, 정상 JSX 허용 | `81f961` |
| `pnpm -r typecheck` | shared/server/mobile 모두 exit 0 | `d96723` |
| `pnpm build` 및 package main 실조회 | exit 0, `apps/server/dist/apps/server/src/index.js` **1825 bytes** | `3e98f1` |
| `pnpm test:scripts` | **68/68 PASS**, fail/skip 0, exit 0 | `e66648` |
| `pnpm --filter @bus-ta/server exec tsx --test src/routes/realtime.test.ts 'src/services/realtime/*.test.ts'` | **12/12 PASS**, fail/skip 0, exit 0 | `ec0111` |
| `pnpm test:cane` | 실제 C++ compile/run **19 PASS**, exit 0 | `3f98d4` |
| `node scripts/test-bell-result-sql.mjs` (아래 격리 DB 환경) | transaction/rollback/retry/legacy/ACL 및 **4경합 PASS**, exit 0 | `8a8fed` |
| `git -c core.safecrlf=false diff --check` | exit 0 | `f3e45c` |

## 설정/소비자 대조

- 설치 Corepack 캐시의 pnpm11.7.0 metadata에서 Node `>=22.13`을 직접 확인했다. root의 `>=22.13.0`, packageManager `pnpm@11.7.0`, CI/Render22.17.0과 정합한다. lock importer는 lint 3개 직접 의존성 추가이며 기존 앱/서버 직접 버전은 유지됐다. frozen/offline 설치는 현재 캐시에서 통과했다.
- lint probe는 실제 설정 아래 미정의 JS 변수(no-undef), 잘못된 JSX/TS(parse-error), 중복 키(no-dupe-keys), 잘못된 typeof(valid-typeof)를 각 1개 오류로 거부하고 선언된 View의 정상 JSX는 오류 0이었다. 파일을 쓰지 않고 stdin의 ESLint API로 검사했다. TS 이름/타입은 별도 tsc가 담당한다.
- shared 모델/헤더 export → 모바일 guide/server config 호환 re-export 및 모바일 fetch/server req.header 소비를 대조했다. scripts에 포함된 계약 2개와 Realtime 12개 회귀가 **gpt-realtime-mini / TTL600 / 인증 성공·거부 / secret 없을 때 헤더 생략**을 검사한다. 실제 OpenAI는 대체했다.
- server start는 `tsx src/index.ts` 그대로다. main은 실제 산출물 경로이며 shared TS 참조가 남아 독립 배포 번들로 판정하지 않는다.
- CI의 lint/typecheck/build/서버/boarding/전체 scripts/C++ 및 별도 PG15 SQL job 연결을 확인했다. SQL job은 Node22.17.0과 PG 환경을 명시하고 boarding shell 다음 bell runner를 실행한다. 실제 Ubuntu CI는 실행하지 않았다.

## SQL: fresh 55440 로그 검토와 독립 55439 실행 구분

**55440은 재실행하지 않았다.** 구현자의 `T5-ci-init.log`, `T5-ci-boarding.log`, `T5-ci-role.log`, `T5-ci-bell.log`를 대조해 fresh 초기화, 전체 migration/boarding/legacy 기대 실패 처리, service_role `rolcanlogin=f / rolbypassrls=t`, bell 4경합 PASS를 확인했다. 작업 temp의 `T5-ci/postgres.log`에 2026-09-23 19:43:11 KST 정상 종료가 남아 있다. fresh cluster 초기화/역할 생성/전체 shell 순서는 **기존 원문 로그 증거**이며 Tester 직접 실행이 아니다.

**55439는 직접 실행했다.** `.agent-loop/pg-env.json`의 host=127.0.0.1/port=55439를 검사하고 `PSQL_BIN=<bin>/psql.exe`, PGHOST=127.0.0.1, PGPORT=55439, PGUSER=postgres, PGPASSWORD=postgres, PGDATABASE=postgres로 고정해 bell runner를 실행했다. 먼저 PostgreSQL15.19 및 service_role NOLOGIN/BYPASSRLS를 실조회했다(`937eb6`).

same/conflicting/cancel-first/result-first 각각 두 별도 psql 세션이 `SET LOCAL ROLE service_role`로 RPC를 실행하며, observer가 두 번째 세션의 `wait_event_type='Lock'`과 첫 commit 전 미완료를 확인했다. Promise만 겹친 모의 경합이 아니다. runner cleanup 이후 별도 SELECT로 `t3-race-%` trips **0**, 경합 application_name 세션 **0**을 확인했다(`f3e45c`). migrations 재적용/역할 변경 없음.

boarding shell의 fresh service_role 생성은 NOLOGIN BYPASSRLS이며 기존 역할을 ALTER하지 않는다. README의 폐기용 빈 DB 전제와 legacy DB 교체 설명이 실제 동작과 맞는다.

## 한계 및 수정 파일

전체 서버 suite/Android bundle은 T7 소유다. 실제 Linux/Node22, 빈 캐시 네트워크 설치, 모바일 실물·ESP32·외부 API·운영 DB·배포는 미검증이다. 기존 peer 경고는 구현 보고에서 확인했으며 독립 `pnpm peers check`는 실행하지 않았다.

Tester 작성 파일은 **`.agent-loop/T5-testing.md` 하나**다. 검증 과정의 ignored dist/node_modules 확인 및 제거된 SQL/C++ 임시 산출물 외 코드/시험 수정 없음. 원본 체크아웃 변경, 커밋/푸시/배포/플래시 없음. **발견 실패 없이 Reviewer로 인계 가능.**

## P2 보완 독립 재시험 — scripts TypeScript 검사

**PASS.** 이전 검증 이후 Reviewer가 발견한 scripts 의미 검사 누락에 대한 별도 재시험이다. 기존 workspace typecheck PASS만으로 scripts가 포함됐다고 판단하지 않는다.

`tsconfig.scripts.json`, root package/CI/README, scripts README 및 `realtime-session.integration.test.ts`의 `routeCandidatesExpiresAt: null` 한 줄을 대조했다. 제품 코드/lock 변경 없이 CI와 문서가 workspace+scripts의 `pnpm typecheck`를 사용한다.

| 직접 실행/확인 | 결과 | 출력 chunk |
| --- | --- | --- |
| `node node_modules/typescript/bin/tsc -p tsconfig.scripts.json --showConfig` 및 `--listFilesOnly` | realtime-completion.test.ts / realtime-contract.test.ts / realtime-session.integration.test.ts **3개 실제 포함** | `f4aa32` |
| 임시 probe를 넣은 `pnpm typecheck` | **예상한 exit 2**, 미정의 이름 TS2304 및 타입 불일치 TS2322 | `758516` |
| probe 제거 후 `pnpm typecheck` | shared/server/mobile + scripts 모두 exit 0 | `8e0721` |
| `pnpm lint` | exit 0 | `0efe90` |
| `pnpm test:scripts` | **68/68 PASS**, fail/cancelled/skipped/todo 0, exit 0 | `bdc45f` |
| P2 범위 `git diff --check` 및 probe 부재 확인 | PASS | `55d760` |

검출 probe는 새 경로 `scripts/__t5_independent_typecheck_probe.test.ts`가 없는지 확인한 뒤 다음 두 줄만 임시 작성했다.

```typescript
export function latent() { return definitelyMissingT5Independent; }
export const mismatch: string = 42;
```

함수를 호출하지 않아도 새 scripts 검사 단계에서 TS2304와 TS2322가 발생했다. expected failure를 단언한 wrapper는 성공했지만 실제 `pnpm typecheck` 종료 코드는 **2**였다. probe는 `finally`에서 제거했고 구현자 probe `scripts/__t5-typecheck-probe.ts`와 함께 부재를 확인한 뒤 GREEN 검사를 실행했다. 기존 제품/시험 파일은 수정하지 않았다.

효과적인 설정은 `strict=true`, `noUncheckedIndexedAccess=true`, `exactOptionalPropertyTypes=false`다. 마지막 옵션만 모바일 import 그래프의 기존 정책에 맞춰 scripts 설정에서 완화하며, workspace 설정을 바꾸지 않고 미정의 이름/기본 타입 오류 검출을 유지한다. 실제 Ubuntu CI 실행은 여전히 미검증이다. 영향 없는 SQL/C++/별도 Realtime/빌드는 반복하지 않았다. 최종 수정 파일은 이 보고서뿐이며 **P2 재검토로 인계 가능**하다.
