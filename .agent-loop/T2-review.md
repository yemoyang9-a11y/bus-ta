# T2 독립 검토 (2026-09-22)

## 판정

- **명세: REJECT** — 완료 시점 이후 하차벨 물리 명령이 새로 시작될 수 있는 P2 경합 한 건이 남았다.
- **코드 품질: REJECT** — 하차 화면의 bell session 수명이 `TRIP_DONE`에 묶여 있지 않아, 완료 후에도 BLE 재연결/STOP_REQUEST와 결과 callback이 계속 진행된다.
- `function-dispatcher.ts`, `RouteList` 및 서버 `guide`는 T4가 수정 중이므로 이 판정에서 제외하며 T4 완료 후 통합 재검토가 필요하다.

## 발견 사항

**[P2] GPS 완료가 하차 화면 진입·BLE 연결과 겹치면 완료 후 STOP_REQUEST를 보낼 수 있다.** `apps/mobile/src/screens/AlightScreen.js:46-74`는 화면 focus 때마다 현재 운행 상태가 `TRIP_DONE`이어도 bell session을 만들고 `flow.start()`를 호출한다. `isCurrent()`는 `CANCELLED`만 배제한다(`:49`). 기존 세션이 진행 중인 상태에서 Provider의 GPS PATCH/GET이 `TRIP_DONE`을 반영해도 callback의 의존성은 `[tripId, bellRequestId]`뿐이라 effect cleanup이 일어나지 않는다(`:84`). 따라서 `PENDING`으로 Alight 이동 → BLE 재연결 대기 → Provider가 `TRIP_DONE`을 반영하고 완료 음성 대기 → 뒤늦게 연결된 bell session이 `sendStopRequest()`를 실행하는 순서가 가능하다. 완료보다 늦은 결과 저장의 상태/성공 음성 차단(`:123-128`)은 이 물리 명령을 막지 못한다. 완료 상태가 되면 미전송 session을 취소하고, focus 진입·각 연결/재시도 경계에서 현재 운행이 아직 미완료인지 확인해야 한다. 이미 시작한 GATT write 자체는 되돌릴 수 없으므로 이후 재시도와 새로운 전송을 막는 경계가 핵심이다. `mobile-alight-screen.test.ts`는 완료 후 저장 callback을 검사하지만 완료 전후 연결 대기에서 물리 STOP 전송 횟수를 고정하지 않는다.

## 확인한 나머지 범위

- `RealtimeProvider.tsx`가 운행 단위 `trip-tracking.ts`를 소유해 Riding→Alight 화면 전환에서도 GPS PATCH를 지속한다. 운행 ID, 완료 및 이전 WAITING 응답 경계와 adaptive GET 재예약을 코드와 시험에서 확인했다.
- `session.ts`는 completionKey로 생성된 response ID를 연결하고 동일 ID의 `response.done(completed)` 및 `output_audio_buffer.started/stopped`를 모두 요구한다. 유한 timeout, local TTS fallback, 늦은 created 취소 및 다음 운행 큐 해제를 확인했다.
- 자동 탑승의 Provider 소비 경로와 새 유효 RSSI·타깃·운행 검사, 서버 성공 전 상태 보존, 수동 확정/취소/다음 운행의 늦은 응답 폐기를 확인했다. 앱의 timestamp/sampleId는 수신 기준이며 실물 송신 표본의 신선도는 펌웨어 보장과 별도로 검증해야 한다.
- 지팡이 준비는 최대 3회·1/2초 지연을 적용하고, 이전 소유자 해제 실패 시 새 운행 타깃으로 넘어가지 않는다. `releaseCane`은 STOP 성공 뒤 disconnect하며 BLE manager는 disconnect 실패 시 장치 참조를 보존한다. MTU185 협상과 64 미만 거절도 코드/시험 범위에서 확인했다.
- 독립 Tester의 최종 **201/201 모바일 연관 시험 PASS**와 모바일 `tsc` PASS는 `.agent-loop/T2-testing.md`의 직접 실행 기록으로 확인했다. Reviewer는 전체 시험을 재실행하지 않았다. 이 결과는 실제 Android GPS/BLE/WebRTC/스피커 검증이 아니다.

Reviewer는 이 문서만 추가했다. 코드·시험·Git 인덱스는 수정하지 않았다.

## P2 보완 재검토 (2026-09-23)

### 최종 판정

- **명세: APPROVE** — 앞서 지적한 완료 뒤 새 STOP_REQUEST 경합이 해소됐다.
- **코드 품질: APPROVE** — 완료 전 이미 시작한 물리 write의 진짜 Notify·결과 저장과, 완료 뒤 금지해야 하는 새 연결·재시도·write를 분리했다. 보완 diff에서 새 중대 회귀를 찾지 못했다.
- 이 판정은 T2의 고정된 Provider/session/BLE/tracking/reducer/screens 범위다. T4 소유 `function-dispatcher.ts`, `RouteList`, 서버 `guide` 변경은 이후 통합 재검토 대상이다.

### 이전 P2 해소 근거

1. `apps/mobile/src/screens/AlightScreen.js:46-64`는 이미 `TRIP_DONE`/`CANCELLED`인 focus에서 bell session을 시작하지 않고, 진행 중 `TRIP_DONE` 전환에는 `stopSending()`을 호출한다. 세션의 `canSend`는 매번 최신 운행 ID와 terminal 상태를 읽는다.
2. `apps/mobile/src/ble/bell-command-sender.ts:168-220`은 연결 상태 확인과 새 연결 전후, Notify 구독 전, 각 STOP write 직전에 `canSend`를 검사한다. 따라서 이전 재현 순서인 PENDING→Alight→connect pending→GPS `TRIP_DONE`→connect resolve에서 STOP write로 진행하지 않는다. 첫 write 실패 뒤 재연결 중 완료되는 경우에도 두 번째 write가 차단된다.
3. `apps/mobile/src/ble/bell-stop-session.ts:12-65`는 write 시작 전 terminal 전환을 `cancelled`로 조용히 끝내며 Alight는 이를 FAIL 저장으로 보내지 않는다. write가 이미 시작된 뒤에는 이를 철회하지 않고 기존 구독과 결과 수명을 유지한다. `AlightScreen.js:98-154`도 같은 운행의 실제 결과 POST는 허용하되 완료 뒤 상태 조회·dispatch·벨 성공 음성을 막는다.
4. 독립 Tester가 실제 Alight 화면·bell stop session·sender를 함께 실행한 집중 회귀 **48/48 PASS**와 모바일 타입 검사 PASS를 `.agent-loop/T2-testing.md` 보완 절에 기록했다. 이미 완료된 focus, 연결 확인/연결/reconnect 대기 중 완료, write ACK 전후 완료와 실제 Notify 보존, 진행 중 POST 보존 및 다음 운행 격리를 포함한다. Reviewer는 동일 시험을 반복 실행하지 않았다.

실제 Android BLE/GPS/WebRTC 및 실물 장치 검증은 여전히 완료되지 않았다. 이번 재검토에서 Reviewer가 수정한 것은 이 리뷰 문서뿐이며 앱·시험·Git 인덱스는 변경하지 않았다.
