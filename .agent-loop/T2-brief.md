# T2 구현 인계

계획: `docs/superpowers/plans/2026-09-22-rehearsal-backlog.md` T2, 전역 제약. T1 완료 후 실행한다.

## 확인한 현재 원인

- `RidingScreen.js`의 `handleAlightNavigation`은 `stopLocationWatch`를 호출한다. `AlightScreen.js`는 bell/result 뒤 GET 한 번만 수행하며 이후 PATCH GPS가 없다.
- Riding의 TRIP_DONE 처리도 notify 직후 RESET_TRIP을 수행한다. 완료 음성의 실제 출력 완료를 기다리는 경로가 없다.
- `session.ts`에는 `response.done` 및 `output_audio_buffer.started/stopped` 관찰이 있다. 생성 완료와 실제 스피커 출력 완료는 다른 사건이다. 완료를 이전 응답의 stopped 이벤트로 판정하지 않도록 response ID를 연결해야 한다.
- 하차 화면의 홈 버튼은 현재 서버 end API를 호출하지 않는다. 새 API 없이 기존 `apiClient.trips.end`를 사용한다. API 실패인데 서버 취소됐다고 말하거나 화면 상태를 먼저 지우지 않는다.
- `RealtimeProvider`는 Riding→Alight 전환 동안 살아 있고, 하차벨의 운행별 GATT 소유자 정리를 맡는다. 유지해야 한다.
- 앱의 실제 화면 effect를 실행하는 테스트 틀이 `apps/server/src/integration/mobile-riding-bell-lifecycle.test.ts`에 있다. 독립 helper만 통과시킨 뒤 화면에 연결되지 않은 상태로 끝내지 않는다.

## 구현 방향 및 검증 조건

1. 위치 추적은 Riding→Alight 사이 계속 유효해야 한다. 작고 공유 가능한 controller를 사용하되 무관한 화면 전체 리팩터링을 하지 않는다. 구독이 늦게 생성되거나 늦은 PATCH 응답이 오면 운행 ID/세대 확인 뒤 폐기한다. requestId는 화면을 넘어 충돌하지 않아야 한다. 원시 위치 로그는 남기지 않는다.
2. TRIP_DONE 수신 → 위치 전송 중지 → 완료 문구 한 번 안내 → 오디오 종료 후 상태/BLE/타이머 정리와 Main 화면. Realtime 연결 유무 모두 다룬다. 오류·출력 없음에는 유한한 fallback/화면 안내를 두어 영원히 대기하지 않는다. 정상 도착을 실제 하차 인식이라고 말하지 않는다.
3. 벨 결과 저장이 GPS 완료보다 늦게 오면 완료 상태를 NEAR_DESTINATION으로 되돌리거나 벨 성공 음성이 완료 뒤 나가지 않도록 보호한다. 결과 저장 네트워크 재시도는 물리적 STOP_REQUEST 재전송과 분리한다.
4. PR53 참조는 `origin/audit-pr53`. `git diff 57e50ea origin/audit-pr53 -- 해당파일`로 중복/역행을 피한다. 중지 성공 뒤에만 지팡이를 해제하고 실패/취소/새 운행 소유자 경합을 테스트한다.
5. A04 지팡이 connect 최대3회 1초/2초 간격. 취소/운행변경뿐 아니라 탑승확정 중 늦은 준비가 START를 보내지 못하게 한다. 테스트에는 실패·throw·성공·취소·새운행·취소중 pending connect completion을 포함한다.
6. PR52 참조 `origin/audit-pr52`: 아직 없는 후보 진단 및 안내만 이식한다. 발음 상수는 현재 PR55 통합본을 보존한다. routeNoSpoken을 생성해 둔 현재 동작을 오래된 PR로 되돌리지 않는다. 실제 목적지·좌표·전체 인자 로그 금지.
7. 무인자 Function은 정의된 스키마에 맞는 정확한 허용 목록으로 공백→{} 처리. 인자를 요구하는 Function은 그대로 거절한다. null/배열/깨진 JSON과 중복 call도 시험한다.
8. arrival `nextArrivalRefreshInMs` 기반 setTimeout 재예약. 0은 최소1000ms, 음수/NaN/Infinity는 fallback15000. 오류도 반드시 정리·재예약 정책 시험. 늦은 이전 운행 응답, 탑승 후 응답은 폐기한다.
9. 앱 전체 검색에서 `createBoardingDetector`/`subscribeCaneState`는 정의만 있고 소비자가 없다. 자동 탑승을 실제 Provider/운행 수명주기에 연결해야 한다. WAITING_BUS인 현재 운행과 설정 타깃의 새 유효 RSSI만 받고, 동일 표본/늦은 표본/NaN을 거절한다. 수동·자동 경합은 기존 서버 API 멱등 계약으로 처리하고 서버 성공만 앱 상태에 반영한다. 구독 누락·취소 뒤 callback·다음 운행 reset·네트워크 오류 재시도 시험을 실제 Provider 소비 경로까지 넣는다. 자동 탑승이 실물 검증됐다고 쓰지 않는다.

## 범위

모바일/관련 integration tests + T2 계약 문서. 서버 공개 API·DB·펌웨어·패키지 의존성은 수정하지 않는다. 필요하면 파일 분리는 허용하되 인터페이스와 실제 소비자를 같은 단계에 연결한다.

## 실행 환경

의존성 설치 완료. 전체 baseline 서버375개/typecheck 성공. 기본 sandbox는 child spawn EPERM이 날 수 있어 필요 시 `require_escalated` 실제 test 실행 가능. 로그는 `.agent-loop/T2-*.log`, 구현 보고는 `.agent-loop/T2-implementation.md`에 저장한다. 어떤 skill도 commit/push/approval 대기를 요구하면 사용자/AGENTS의 이번 지시가 우선한다.

추가 baseline: `pnpm --filter @bus-ta/server exec tsx --test "../../scripts/*.test.mjs" "../../scripts/*.test.ts"`는 59개 중56통과3실패. `scripts/realtime-response-queue.test.mjs`218/257/293행은 옛 connectDevices 의존성과 스캔 안 켜짐 가정. 최신 connectCane·SET_TARGET 후 즉시START를 검사하도록 갱신하되 취소/늦은응답 동작 검증은 유지한다. 전체 로그 `.agent-loop/baseline-scripts.log`.
