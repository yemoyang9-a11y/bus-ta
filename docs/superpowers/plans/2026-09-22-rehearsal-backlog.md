# 리허설 문제 및 미뤄 둔 작업 실행 계획

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. 사용자 요청에 따라 문서 작성 후 승인 대기 없이 구현·시험·검토를 순서대로 진행한다. 단계는 체크박스로 추적한다.

**Goal:** 지팡이 재접근, 하차 이후 완료 흐름을 복구하고 조사된 후속 작업을 구현·검증·결정·외부 확인으로 빠짐없이 종결 관리한다.

**Architecture:** 최신 통합 `57e50ea`를 기반으로 기존 BLE 명령과 공개 API를 보존한다. 모터 제어와 앱 수명주기는 순수 로직을 추출해 재현 시험을 가능하게 하고, 하차벨 결과는 DB의 단일 트랜잭션에서 기록한다. 과거 로컬 환승 검색은 검색·안내 범위만 이식한다.

**Tech Stack:** TypeScript, React Native/Expo, Node.js, pnpm 11.7.0, PostgreSQL/Supabase, ESP32 Arduino C++.

**Spec:** 원본 작업 폴더 `output/deferred-work-audit-2026-09-22.md`의 R01–R03, A01–A10, V01–V09, D01–D09, M01–M12 및 사용자의 이번 리허설 설명. 상세 계약은 `docs/PROJECT_OVERVIEW.md`, `API_SPEC.md`, `DB_SCHEMA.md`, `MODULE_CONTRACTS.md`. 환승은 로컬 커밋 `ebb5bdd`의 `docs/superpowers/specs/2026-09-03-multimodal-route-design.md`.

## 공통 제약

- 기존 사용자 변경은 원본 작업 폴더에 보존한다. 작업 위치는 `.worktrees/rehearsal-20260922`, 기준 커밋은 `57e50eaffd3d4fcecae84a9f6710710e9268ad38`이다.
- 기존 `codex` 브랜치가 `codex/` 접두어를 막으므로 전용 브랜치는 `codex-rehearsal-backlog-20260922`다. 기존 브랜치를 삭제하지 않는다.
- 구현·검증 당시에는 커밋·푸시·병합·배포·운영 DB 변경·외부 메시지 발송을 하지 않는다. `.agent-loop/DIRECTOR.md`의 오래된 커밋/푸시 사전승인보다 현재 AGENTS 규칙을 우선한다. 이후 사용자가 커밋과 PR 생성을 명시적으로 요청했으므로 이번 feature 브랜치의 커밋·푸시·PR은 허용된다. 병합·배포·운영 DB 변경은 이 후속 요청에 포함되지 않는다.
- 공개 JSON은 `camelCase`, DB는 `snake_case`. ODsay 내부 숫자 경로 유형은 공개하지 않는다.
- 탑승 전 GPS는 `WAITING_BUS`. `remainingStations = 2`는 안내만, `1`의 `NOT_REQUESTED`는 벨 한 번, `PENDING`/`SUCCESS`/`FAIL`을 새 물리적 벨 요청으로 바꾸지 않는다.
- 목적지 정류장 도착과 실제 하차 감지를 구분한다. 완료 음성은 “목적지 정류장에 도착했습니다. 안전하게 내리세요. 안내를 마칩니다.”를 기준으로 한다.
- 좌표·키·토큰·목적지 원문을 진단 로그에 남기지 않는다.
- 사용자 제공 프로젝트 URL은 Chrome 로그인 세션에서 열렸으나 Notion 연결 API는 404다. 사용자는 2026-09-23에 오래 갱신하지 않은 Notion 문서보다 최근 제시한 방향과 최신 코드를 최종 기준으로 삼으라고 명시했다. 직행 전용이라는 과거 Notion 문구와 T4의 안내 전용 환승 검색 차이는 결과에 남긴다. 사용자 인증·차량 매칭·새 상태/API는 추측해 추가하지 않는다.
- 각 작업의 구현 담당 → 시험 담당 → 검토 담당 → Director 확인 순서를 유지한다. T1 검토와 T2 모바일·T3 서버/DB는 수정 파일이 겹치지 않아 병렬 진행한다. T3 완료 뒤 T4의 서버·shared·문서 작업을 시작하며, T4 모바일 연결은 T2 편집 종료 뒤에만 진행한다. T5는 T4 뒤에 진행해 공용 파일 동시 수정을 막는다. 단계별 실행 결과는 `docs/superpowers/plans/2026-09-22-rehearsal-results.md`에 누적한다.

## 검토 초점

1. 약한 재접근·한 번의 광고 누락으로 진동이 영구 중지되지 않아야 한다. T1의 RSSI 재생 시험으로 고정한다.
2. 하차벨 화면 전환·늦은 GPS 응답·완료 음성 재생 중 초기화가 겹쳐도 안내 종료가 유실되거나 중복되지 않아야 한다. T2 수명주기 시험으로 고정한다.
3. 연결 재시도 도중 취소·다음 운행으로 넘어가면 이전 연결과 타이머가 새 운행에 영향을 주면 안 된다. T2 장치 시험으로 고정한다.
4. 벨 결과 중복·상충·운행 취소·DB 중간 실패에서도 두 테이블 결과가 일치해야 한다. T3 SQL·서비스 시험으로 고정한다.
5. 환승 후보를 검색하더라도 추적이 지원되지 않는 운행이나 잘못된 방향의 직행 후보를 생성하면 안 된다. T4 계약 시험으로 고정한다.

## T1. 지팡이 신호 복구와 점진적 진동 (R01/R02/V03/V05)

**파일:** `hardware/smart-cane/ble_stick.ino`, `hardware/smart-cane/README.md`; 추가 `hardware/smart-cane/proximity-feedback.h`, `hardware/smart-cane/tests/proximity-feedback.test.cpp`, 실행 도구 `scripts/test-cane-feedback.mjs`.

**경계:** BLE 서비스·특성 UUID와 START/STOP/SET_TARGET 및 Notify 계약은 유지한다. C++ 제어기는 RSSI와 단조 시간을 입력받아 0–255 모터 출력을 반환한다. 실제 ESP32 빌드와 호스트 재생 시험은 따로 기록한다.

- [x] 기존 펌웨어의 상태 고착·즉시 OFF 경로를 확인하고 실패 재생 시험을 작성한다. 예: `near(-58) -> far(-82) -> near(-66)`은 마지막에 출력이 0보다 커야 하며 멀어지는 동안 출력은 단계적으로 내려가야 한다.
- [x] 제어기를 비차단 방식으로 구현한다. 한 번의 누락은 유예하고 제한 시간 뒤 0으로 감쇠한다. STOP은 즉시 0, START/대상 변경은 이전 필터·상태를 초기화한다. 신호가 돌아오면 이전 LEAVING과 무관하게 회복한다.
- [x] PWM을 GPIO25에 연결하고 지원 Arduino ESP32 버전 차이를 처리한다. 모터 회로는 문서에 명시하며 실제 회로 교체·플래시는 수행했다고 주장하지 않는다. BLE 연결 해제 후 재광고를 보장한다.
- [x] 자동 탑승 입력을 위해 상태가 같아도 새로 관측한 타깃 원시 RSSI를 최대 1초 간격으로 Notify한다. 수신한 새 표본만 전송하고 신호 누락 중 과거 RSSI를 새 표본처럼 반복하지 않는다. 출력 필터와 자동 탑승 RSSI는 분리한다.
- [x] 시간 역전/오버플로, 일시 누락, 장기 누락, STOP 재시작, 대상 변경, 느린 재접근 시험을 실행한다. 호스트 컴파일러가 없으면 설치 가능한 격리 도구 또는 명시적 대체 경로를 마련한다.

## T2. 운행 완료·음성·장치 수명주기 (R03/A01–A06/D09)

**파일:** `apps/mobile/src/screens/RidingScreen.js`, `AlightScreen.js`, `apps/mobile/src/realtime/function-dispatcher.ts`, `assist-device-preparation.ts`, `session.ts`, 관련 `*.test.ts`/`scripts/*test.mjs`; 필요한 단일 책임의 위치/완료/지팡이 해제 컨트롤러. `docs/FRONTEND_GUIDE.md`, `REALTIME_GUIDE.md`, `ARRIVAL_POLLING.md`.

**경계:** 기존 status PATCH/GET와 boarding confirm/end_trip만 사용. 조회 간격은 `nextArrivalRefreshInMs`. 빈 인자는 계약상 무인자 Function에서만 `{}`. PR53의 핵심은 STOP 성공 후 disconnect이며 실패 시 중지 재시도 경로를 보존한다.

- [x] 하차 화면에서 위치 전송이 계속되고 목적지 `TRIP_DONE`이 수신되는 재현 시험을 먼저 작성한다. 완료 음성은 한 번 재생하고 끝난 뒤 앱 상태·GPS·BLE·타이머를 정리한다. 음성이 불가능한 경우 제한 시간과 화면 안내로 정리를 보장한다.
- [x] 홈 복귀/취소는 기존 `end_trip` 계약과 일치시킨다. 남아 있는 비동기 응답이 종료된 운행을 복원하지 못하게 한다. 원시 좌표·오류 객체의 민감 로그를 제거한다.
- [x] 빈 문자열/공백 `confirm_boarding`, `get_next_route_candidates` 성공, 유인자 함수의 빈 입력 거절, 잘못된 JSON 거절 시험을 작성하고 정규화한다.
- [x] PR52를 최신 통합과 비교해 중복 발음 변경은 제외하고 후보 선택 전 안내/진단 누락만 반영한다. 마지막 후보·소진 안내는 서버 공개 계약을 임의 확장하지 않고 내부 후보 저장소 정보로 만든다.
- [x] PR53의 STOP 후 연결 해제를 최신 코드에 이식한다. STOP 실패 시 연결 유지, disconnect 실패 복구, 다음 운행 연결을 시험한다.
- [x] 지팡이 연결은 최대 3회, 1초/2초 대기, 취소/운행 변경 시 즉시 중단한다. 실패 안내는 장치별 성공·실패 및 실제 재시도 횟수와 일치시킨다. 당시 발화를 확인하지 못한 한계를 남긴다.
- [x] 도착 조회는 `Math.max(1000, nextArrivalRefreshInMs)`를 사용하고 값 부재/잘못된 값에만 15000ms로 복구한다. 각 응답 뒤 다시 예약하며 취소·탑승확정·화면 이탈 시 이전 예약을 정리한다. `nextArrivalRefreshInMs=60000`에서 15초 반복이 없어야 한다.
- [x] 자동 탑승 임계값은 현장 데이터 없이 바꾸지 않는다. 최신 즉시 START 정책을 유지하고 자동/수동 경로의 상태 회귀 시험을 실행한다.
- [x] 실제 앱에서 `subscribeCaneState`→`createBoardingDetector`→`AUTO_DETECTED` 확인 API 연결을 복구한다. 현재 두 함수는 정의만 있고 소비자가 없다. WAITING_BUS·현재 운행·설정된 타깃의 새 표본만 사용하며, 취소/탑승확정/새 운행 시 구독과 감지 창을 초기화한다. 서버 성공 전 앱을 ON_BUS로 바꾸지 않는다. 수동 확정과 경합, 실패 후 제한 재시도, 다음 운행을 통합 시험한다.

## T3. 하차벨 결과 원자성 (A07)

**파일:** `apps/server/src/repositories/supabase/trip.repository.ts`, 관련 repository/service 시험, CLI로 생성한 `supabase/migrations/*_atomic_bell_result.sql`, `supabase/tests/bell_result_atomicity.sql`, `scripts/test-supabase-boarding.sh` 또는 별도 SQL 실행기, `docs/API_SPEC.md`, `DB_SCHEMA.md`.

**경계:** POST bell/result의 기존 입력·응답·오류 코드를 유지한다. 한 RPC 트랜잭션에서 요청/운행을 검증하고 `bell_logs`와 `trip_status`를 함께 기록한다. 잠금 순서는 기존 위치/취소 RPC와 일치시켜 교착을 피한다. PUBLIC/anon/authenticated 실행을 회수하고 service_role만 허용한다.

- [x] 현재 두 저장 중 두 번째 실패, 동일 결과 재전송, 상충 결과 동시 저장, 취소와 경합의 실패 시험을 만든다.
- [x] 기존 첫 확정 결과 우선·재전송 규칙을 읽고 동일하게 구현한다. 새 물리적 벨 요청/새 public API/자동 FAIL 재작동은 추가하지 않는다.
- [x] 로컬 PostgreSQL에서 migration 및 SQL 시험을 실제 실행한다. `BEGIN; ... ROLLBACK;`로 fixture를 격리하고 장애 주입 시 두 테이블이 모두 롤백되는 것을 검증한다.
- [x] 운영 적용 전 migration 선행 조건을 문서화한다. 로컬 수정만으로 운영 DB에 적용됐다고 쓰지 않는다.

## T4. 남은 경로 통합과 조회 회귀 시험 (A08/A09/A10/V07/M12)

**파일:** 로컬 `ebb5bdd`가 수정한 route schema/type, route adapter/test, guide/test, mobile route list/dispatcher, 관련 계약 문서; `apps/server/src/services/arrival/*` 및 방향 판정 시험.

**경계:** 기존 `DIRECT_BUS` 기본값, `ROUTE_SEARCH_SCOPE=MULTIMODAL`일 때 검색·안내만 확장한다. 환승 후보는 `tripSupported: false`; 실제 환승 추적·지하철 단독·새 DB 필드는 제외한다. `ROUTE_SEARCH_MODE=MOCK`을 사용하는 로컬 mock provider는 별도 설정이며 보존한다.

- [x] 최신 후보·노선 발음·오류 처리와 로컬 변경을 3방향 비교해 이식한다. 원본 사용자의 작업은 수정하지 않는다.
- [x] 버스 직행/환승/버스+지하철/지하철 단독/잘못된 후보를 시험한다. 추적 불가 후보의 UI 선택과 `create_trip` 호출을 모두 차단한다.
- [x] PR44 테스트와 현재 캐시를 비교해 반복 강제 요청, 지속 오류, 예외, stale 폐기 뒤 최소 간격을 시험한다. 발견된 실제 결함만 수정한다.
- [x] 방향 판정의 100m 경계, 세 번 등장하는 목적지, 순환 노선을 fixture 시험으로 보완한다. 실제 GBIS 표본 검증과 구분한다.
- [x] 모호한 Kakao 첫 결과는 원문 결과·현재 API 한계·가능한 오안내를 검토해 결정 문서에 남긴다. 목적지 확인 계약 없이 임의 첫 장소를 확정하는 기능 확대는 하지 않는다.

## T5. 실행·품질 검사 정리 (M05/M10/M11)

**파일:** root/server/mobile/shared `package.json`, lint 설정, CI, Realtime 공통 상수와 소비자, `scripts/README.md`.

- [x] 설치된 pnpm의 실제 engine 요구와 CI Node22.17.0을 대조해 최소 버전 선언을 정렬한다. 잠금 파일의 pnpm11.7.0은 유지한다.
- [x] `main`을 실제 build 산출물과 일치시키고 서버 build로 경로를 검증한다.
- [x] 모델명/헤더 상수 중복을 기존 shared 공개 경계로 통합하고 기존 기능 시험을 실행한다.
- [x] 실제 작동하는 lint를 설정한다. 광범위 자동 포맷 변경 없이 미정의 변수·잘못된 구문 등 유의미한 오류를 검사하고 CI에 연결한다. Reviewer P2에 따라 root scripts TypeScript도 별도 tsc로 검사한다.

## T6. 문서·결정·현장 시험 인계 (나머지 모든 ID)

**파일:** `README.md`, `docs/DEVELOPMENT_PLAN.md`, `DEMO_SCENARIO.md`, `TROUBLESHOOTING.md`, `demo-scenario/*`, 하위 구 명세/흐름 문서, `personal-notes/REMAINING_CHECKLIST.md`, `PENDING_DECISIONS.md`, 결과 문서.

- [x] M01/M02: 오래된 미완료 체크와 현재 상태를 구분하고 잘못된 첫 GPS ON_BUS/과거 노선·비콘 예시/위치 지연 저장 설명을 바로잡는다. 역사 인수인계는 삭제하지 않고 최신 결과로 연결한다.
- [x] M03: seed는 실제 운영 비콘을 덮어쓰지 않는 현 정책을 유지하며 변경은 새 명시적 migration으로만 한다. M04: 추가 저장소 수요 없는 선택적 큰 리팩터링·메서드 제거는 하지 않는다. M06: 변경 보존 목록·작업 폴더 위치를 기록하고 옛 worktree를 삭제하지 않는다.
- [x] D03/D04/D05/D06/D07: stale 값의 최신 안내 금지, GET 도착정보 유지, system_logs 확장 안 함, fixture 읽기/쓰기 실패 경계 및 fixture ACTIVE 의미를 현재 구현에 맞춰 문서로 확정한다. GET은 오류 상태와 기존 배열을 함께 반환할 수 있으므로 “stale 공개 안 함”으로 잘못 요약하지 않는다.
- [x] D01/D02/D08: 다차량 매칭·탑승 전 남은 정류장·인증/기록/ERROR 확장은 계약·실물 배치가 필요한 별도 후속으로 표시한다. 원시 RSSI 저장 공개 API는 추가하지 않는다.
- [x] V01–V09: 현장 시험 표에 빌드/펌웨어 버전, 자동/수동 탑승 구분, 거리 왕복, 누락·재연결, 2/1/0정류장, 벨 Notify/DB 기록, 다음 운행, 도착정보 5→3→2분, 실제 발음을 적는다. 관측되지 않은 셀은 통과로 채우지 않는다. API 좌석·방향 표본, ODsay IP/쿼터와 Realtime smoke는 필요한 외부 상태와 정확한 완료 조건을 명시한다.
- [x] M07/M08/M09: 제출본·실물 사진/영상·팀/멘토 정보, Notion 접근, 개인 도구 사전승인 설정은 확인된 사실만 기록한다. 사용자 자료를 지어내거나 개인 권한을 변경하지 않는다.
- [x] 모든 R/A/V/D/M ID를 결과 표와 연결하고 구현 완료/검토 후 유지/외부 확인 필요를 명확히 구분한다.

## T7. 전체 검증과 최종 검토

- [x] 모든 관련 서버·모바일 순수 로직·스크립트 시험, 전체 typecheck/build/lint, 펌웨어 호스트 시험, SQL 실제 시험을 실행한다.
- [x] Expo Android 번들을 로컬로 생성해 JSX·모듈 연결도 검증한다. 번들 생성 성공은 APK 설치·실기기 음성/BLE 검증과 구분한다.
- [x] 독립 검토자가 변경 diff와 위 검토 초점을 확인한다. 중대한 지적은 재현 시험을 추가하고 해결한 뒤 해당 검증을 다시 실행한다.
- [x] 원본 작업 폴더의 기존 수정 보존, 비밀값 미포함, 사용자 요청 밖 변경 없음, Git 미커밋 상태를 확인한다.
- [x] 결과 문서에 실제 실행 명령·결과·미실행 이유·외부 적용 순서를 기록한다. 실기기/운영 미검증을 숨기지 않는다.
