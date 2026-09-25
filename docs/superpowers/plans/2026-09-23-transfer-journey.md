# 환승 여정 이어가기 구현 계획

설계: [2026-09-23-transfer-journey-design.md](../specs/2026-09-23-transfer-journey-design.md)

기준 커밋: `e7ca0ea` (PR #57 병합). 원본 checkout의 사용자 수정은 보존하고 `codex-transfer-trip-20260923`에서 작업한다. 버스 구간은 기존 서버 trip, 전체 여정은 앱 상태로 관리한다. 사용자가 선택한 규칙은 **하차 확인 후 다음 구간 전환**이다.

## 1. 경로 계약과 ODsay 정규화

- 파일: `packages/shared/src/schemas/route.schema.ts`, `packages/shared/src/types/route.ts`, `apps/server/src/adapters/routes/hyorin-route-search.adapter.ts`, 관련 어댑터 테스트.
- 버스 segment마다 검증된 `busLeg` 식별자·정류장 목록을 추가하고 실행 가능한 환승 후보에 `journeySupported`를 제공한다. 직행 후보의 기존 필드·순위는 보존한다.
- RED: 두 번째 버스 구간의 실제 ID·정류장과 불완전 구간 거부를 검사한다. GREEN: 정규화 구현 후 공유 스키마와 서버 어댑터 테스트를 통과시킨다.

## 2. 순수 여정 상태 전이

- 파일: `apps/mobile/src/state/transfer-journey.ts`, `trip-reducer.ts`, `realtime/types.ts`, 관련 스크립트·통합 테스트.
- 시작·도보 도착·지하철 탑승/하차·버스 구간 생성·서버 도착·실제 하차·최종 완료를 구분한다. 중복·역행 전이와 다른 tripId의 늦은 결과는 무시한다.
- RED: 버스→버스와 버스→지하철 중간 TRIP_DONE이 전체 여정을 지우는 현상을 고정한다. GREEN: 현재 구간만 완료하고 사용자 확인을 기다리는 reducer를 만든다.

## 3. 화면과 기존 버스 운행 연결

- 파일: `RouteListScreen.js`, 새 `TransferScreen`, `App.tsx`, `MainScreen.js`, `RidingScreen.js`, `AlightScreen.js`, `RealtimeProvider.tsx`, `trip-tracking.ts`, `completion-speech.ts`.
- 환승 카드 선택 시 여정 화면으로 이동한다. 도보·지하철은 확인 버튼과 현재 구간 안내를 표시한다. 버스 구간은 해당 `busLeg`로 기존 API를 호출하고 Riding/Alight 흐름을 사용한다. 중간 버스 목적 정류장에서는 전체 종료 문구 대신 하차 안내를 말하고, 하차 확인 뒤 여정 화면의 다음 구간으로 돌아간다. 마지막 구간만 최종 완료한다.
- RED/GREEN: 모바일 통합 하네스로 단계별 화면·API 호출·중복 완료·이전 BLE 세션 차단을 검증한다.

## 4. 음성 조작

- 파일: `apps/mobile/src/realtime/guide.ts`, `function-dispatcher.ts`, `types.ts`, 관련 통합 테스트.
- `start_journey`, `confirm_journey_step`, `start_journey_bus`를 추가한다. 후보 ID와 현재 단계는 앱이 검증하며 모델이 버스 ID·역·좌표를 조립하지 않는다. 기존 `create_trip`은 직행 버스 전용으로 유지한다. 성공·실패 안내는 화면 상태와 서버 결과만 근거로 한다.
- RED/GREEN: 음성으로 환승 선택→버스 구간→하차 확인→다음 구간을 진행하고 잘못된 단계·만료 후보를 거부한다.

## 5. 계약 문서와 전체 검증

- 파일: `docs/API_SPEC.md`, `docs/PROJECT_OVERVIEW.md`, `docs/FRONTEND_GUIDE.md`, `docs/MODULE_CONTRACTS.md`, `README.md`, 실물 재시험표.
- 새 공개 경로 필드와 **서버 trip은 버스 한 구간, 앱 여정은 전체**라는 경계를 명시한다. 기존 Notion의 오래된 직행 전용 서술과 충돌은 사용자 최신 우선 규칙에 따라 공개한다.
- 실행: `pnpm typecheck`, `pnpm lint`, `pnpm build`, 서버·스크립트 테스트, Android export. 필요 시 DB 변경 없음 확인. 실패 시 원인부터 조사한다.
- 로컬 검증과 실제 ODsay/GBIS·지하철·버스·BLE 실물 검증을 분리해 보고한다.

## 순서와 완료 기준

1→2→3→4→5 순서로 진행한다. 1의 `busLeg`를 2·3이 사용하고, 2의 상태 전이를 3·4가 공통 사용한다. 기존 직행 테스트를 유지하며, 사용자가 실제 하차를 확인하기 전에 다음 교통수단 탑승을 확정하지 않는다. 운영 배포·마이그레이션·실물 완주는 이 계획의 로컬 구현 완료로 간주하지 않는다.

## 실행 기록

- 1 완료: 환승 후보의 각 버스 구간에 실행 가능한 식별자와 정류장 목록을 붙였다. 대체 노선 여러 개 중 실제 추적할 번호만 표시한다.
- 2 완료: 앱 여정의 구간과 단계를 관리한다. 버스 `TRIP_DONE`은 실제 하차 확인 대기로 전환하고, 마지막 지하철도 탑승만으로 완료하지 않는다.
- 3 완료: 환승 화면의 도보·지하철·버스 단계, 확인 버튼, 버스 구간별 기존 운행/하차벨 흐름, 취소와 늦은 운행 생성 결과 처리를 연결했다.
- 4 완료: `start_journey`, `confirm_journey_step`, `start_journey_bus`, `cancel_journey` 음성 Function을 추가했다. `create_trip`은 직행 전용이다.
- 5 로컬 검증 완료: 전체 타입 검사·lint·서버 빌드·서버 전체 테스트·스크립트 테스트·Android 번들 생성이 통과했다. 상세한 현장 확인 순서는 [시연 시나리오](../../DEMO_SCENARIO.md#2026-09-23-환승-여정-실물-재검증)에 `미실행`으로 남겼다.
- PR 검토 반영: 화면·음성이 동시에 버스 운행을 시작해도 이미 채택한 동일 trip을 취소하거나 탑승 상태를 초기화하지 않는다. 환승 버스 도착 안내 음성은 Riding 화면 이탈로 끊지 않는다. 취소 후 같은 후보를 다시 선택한 여정은 새 세대값을 사용해 이전 버스 생성 응답과 요청 공유에서 분리한다. 세 경우 모두 재현 테스트를 추가했다.
- PR CI 수정: 같은 여정에서 버스 생성 성공 직후 두 번째 호출이 새 POST를 만들지 않도록 성공 결과를 구간·세대별로 재사용한다. 생성 실패는 캐시에서 제거해 재시도한다. Linux 테스트 로더가 서로 다른 import 경로를 별도 모듈 인스턴스로 취급하므로, 음성 테스트는 활성 운행을 이미 채택한 상태를 직접 재현하고 요청 공유는 독립 상태 테스트에서 검증한다.

기기·운영 확인은 별도다. 앱 메모리 여정은 프로세스 재시작 시 복원되지 않는다. 지하철 실시간 운행·GPS 하차 감지와 도보 턴 안내는 구현 범위 밖이다. Notion의 과거 직행 전용 서술은 사용자가 확정한 최신 코드·로컬 설계 우선 규칙과 다르며, Notion 원문은 이번 구현에서 수정하지 않았다.
