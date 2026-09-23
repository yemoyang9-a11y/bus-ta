# T2 구현 인계 — 2026-09-22

작업 위치: `.worktrees/rehearsal-20260922`, 기준 `57e50ea`. 커밋/푸시/배포/운영 DB 변경/펌웨어 플래시 없음. 원본 체크아웃 수정 없음. T2 파일 범위만 수정했으며 독립 Tester/Reviewer 확인은 다음 단계다.

## 구현 내용

1. **운행 추적 수명주기**: GPS와 arrival polling을 유지되는 RealtimeProvider의 운행별 `trip-tracking.ts`로 이동했다. Riding→Alight에서도 PATCH를 계속하고, 위치 requestId는 모듈 단위 순번을 쓴다. 늦게 생성된 구독·이전 운행 응답·탑승 후 WAITING 응답·완료 뒤 이전 상태를 버린다. 권한/구독 실패/없는 운행은 추적을 중지하고 화면 오류로 전달한다. 일시 조회 실패는 GPS를 중단하지 않는다.
2. **완료 음성**: TRIP_DONE에서 GPS/polling을 중지하고 고정된 목적지 정류장 도착 문구를 한 번 안내한다. response metadata의 completionKey와 response ID를 연결해 생성 완료(completed)와 동일 response의 started/stopped를 함께 기다린다. 타임아웃 20초 뒤 로컬 TTS(최대 15초)로 대체하며 화면에도 완료 문구를 표시한다. 실제 하차 감지라고 표현하지 않는다. 종료/운행 변경은 이전 음성과 큐를 취소한다. timeout 이후 늦은 response.created는 tombstone으로 식별해 해당 response만 취소하며 cleared 이벤트 뒤 다음 운행의 음성 큐가 풀린다.
3. **Alight**: 홈은 기존 end API 성공 후에만 초기화한다. 실패 시 운행 보존 및 재시도 안내. 벨 저장은 최대3회(1/2초) 재시도하며 물리 STOP_REQUEST의 재전송과 분리했다. 완료보다 늦은 저장은 상태와 성공 음성을 되돌리지 않는다.
4. **자동 탑승**: 실제 Provider effect에서 subscribeCaneState→기존 boardingDetector→AUTO_DETECTED 확인 API까지 연결했다. 대기 중 현재 운행/설정된 타깃, 유효 RSSI, 새 수신 timestamp/sampleId만 사용한다. 7초/-60dBm 임계값은 유지했다. 서버 성공 전에 앱 상태를 바꾸지 않는다. 동일 requestId로 최대3회 네트워크 재시도 뒤 수동 확인을 안내하며 취소/수동 확정/새 운행의 늦은 응답과 callback을 폐기한다.
5. **지팡이**: 최대3회 연결, 1초/2초 대기. 취소/탑승/운행 변경 시 추가 연결/START를 막고 pending native 연결은 유한 연결 예산 안에서 반환된 후 직렬 소유권 정리에 합류한다. STOP 성공 후 disconnect하며 STOP 실패는 연결을 보존한다. disconnect 실패도 연결 참조를 보존해 다음 STOP/해제 시도가 가능하다. 이전 소유자 해제 실패는 새 타깃/START로 덮어쓰지 않는다. 실패 안내에 실제 attempts/attempted/retryable을 전달한다.
6. **MTU**: 설치 BLE-PLX Device.requestMTU의 실제 API/반환 계약을 확인했다. White_cane은 MTU185 협상 결과가 최소64여야 채택하며 실패/부족 MTU는 native 연결을 정리한다. 서비스 탐색보다 먼저 확인한다. 펌웨어의 local MTU185 설정(T1)과 문서를 정렬했다. UUID/Notify JSON 형식은 그대로다.
7. **Function/후보**: 빈문자열/공백을 빈 객체로 정규화하는 정확한 무인자 목록은 confirm_boarding/get_next_route_candidates뿐이다. 유인자 함수/null/배열/깨진JSON은 거절한다. 같은 call_id 중복은 세션에서 제거한다. 후보 개수/만료/반환 개수만 진단하며 마지막 batch/남은 개수를 모델 내부 응답에 추가했다. routeNoSpoken/toSpokenRouteNo 최신 발음은 보존했다. 공개 API 추가 없음.
8. **arrival**: 응답의 nextArrivalRefreshInMs로 setTimeout 하나를 재예약한다. 0→1000ms, 부재/음수/NaN/Infinity→15000ms. 오류도15000ms로 재예약. 탑승/취소/교체 뒤 늦은 조회 응답은 버린다. 기존 scripts의 connectAll/스캔 지연 기대3개를 connectCane 및 SET_TARGET 후 즉시 START 정책으로 고쳤다.

## 변경 파일

앱 변경:
- `apps/mobile/src/realtime/RealtimeProvider.tsx`
- `apps/mobile/src/realtime/trip-tracking.ts` (추가)
- `apps/mobile/src/realtime/automatic-boarding.ts` (추가)
- `apps/mobile/src/realtime/completion-speech.ts` (추가)
- `apps/mobile/src/realtime/session.ts`, `response-queue.ts`, `function-dispatcher.ts`, `assist-device-preparation.ts`, `assist-device-status.ts`, `status-snapshot.ts`, `types.ts`
- `apps/mobile/src/screens/RidingScreen.js`, `AlightScreen.js`
- `apps/mobile/src/state/trip-reducer.ts`
- `apps/mobile/src/ble/bleManager.js`, `boardingDetector.js` (JSDoc 계약), `boardingDetector.d.ts` (추가), `cane-release-controller.ts` (추가)

시험 변경/추가:
- `apps/server/src/integration/mobile-{alight-screen,assist-device-preparation,ble-manager,function-dispatcher,riding-bell-lifecycle,trip-reducer}.test.ts`
- `apps/server/src/integration/mobile-{trip-tracking,automatic-boarding,cane-release}.test.ts` (추가)
- `scripts/realtime-response-queue.test.mjs`, `scripts/realtime-completion.test.ts` (추가)

문서: `docs/FRONTEND_GUIDE.md`, `docs/REALTIME_GUIDE.md`, `docs/ARRIVAL_POLLING.md`.

## 검증

기본 sandbox의 pnpm exec는 tsx 명령 해석 실패가 있어 동일 명령을 승인된 require_escalated 실행으로 검증했다. 최종 명령은 실패 시 프로세스 exit code를 보존했다.

- `pnpm --filter @bus-ta/server test`: **416/416 PASS**, `.agent-loop/T2-full-server-final.log`.
- `pnpm --filter @bus-ta/server exec tsx --test "../../scripts/*.test.mjs" "../../scripts/*.test.ts"`: **66/66 PASS**, `.agent-loop/T2-full-scripts-final.log`.
- `pnpm typecheck`: **shared/server/mobile PASS**, `.agent-loop/T2-full-typecheck-final.log`.
- `git diff --check -- apps/mobile/src apps/server/src/integration scripts/realtime-response-queue.test.mjs docs/FRONTEND_GUIDE.md docs/REALTIME_GUIDE.md docs/ARRIVAL_POLLING.md`: PASS (Windows 줄바꿈 변환 예고만 있음).
- 실제 Provider/Riding/Alight 소스를 VM으로 실행하는 hook 시험이 GPS blur→Alight→완료, local TTS fallback, 자동 API 성공 전 상태 유지, 수동 경합/취소/새 운행, 홈 서버 성공 경계, 늦은 벨 저장/물리요청 분리를 확인한다. 실제 native IO만 대체한다.
- 주요 실패 재현 기록: `T2-red-initial.log`, `T2-red-stale.log`, `T2-red-mtu.log`, `T2-red-next-trip.log`, `T2-red-late-completion.log`, `T2-red-cleared.log`. 새 순수 controller 인터페이스 시험은 테스트 골격에서 실패를 확인한 뒤 구현했다. 중간 실패/타입 오류는 모두 최종 검사 전에 해소했다.
- 전체 416/66 수치는 공유 격리 작업폴더의 T1/T3 변경도 포함한 당시 전체 검사다. T2만의 실차 성공 수치가 아니다.

## 책임 이동 대조

Riding의 GPS 권한/구독, single-flight PATCH, late subscription cleanup, 운행 ID 보호, 도착정보 전달 및 오류 정리는 Provider/controller로 이동했다. 탑승 후 bell preconnect·공식 notifyFailure·벨 PENDING 화면 전환·접근성 UI는 Riding에 보존했다. shouldTriggerBell을 reducer에도 보관해 실제 화면 소비를 잃지 않게 했다. 다음 운행은 이전 벨 요청과 화면의 bellHandledRef를 초기화한다. 화면 이동 자체로 GATT를 끊지 않으며 실제 운행 변경 뒤 Provider가 소유 운행의 bell을 정리한다.

## 독립 시험/검토에서 확인할 초점

- GPS/GET/벨 저장의 교차 응답과 TRIP_DONE 단조성, 실제 화면 소비 연결.
- Realtime metadata 상관·done와stopped 분리, deadline 뒤 늦은 created/cancel/cleared, 다음 운행 복구.
- pending cane connection과 취소/탑승, STOP 실패 및 disconnect 실패 후 소유권 보존.
- MTU request 실패/64 미만 처리, Notify 타깃 태깅 및 stale subscription 차단.
- arrival error 재예약과 탑승/운행 교체 뒤 늦은 응답 폐기.

## 남은 외부 확인 및 한계

실제 Android 설치/휴대폰 GPS 간격/실물 BLE MTU 협상/실차 RSSI 자동탑승/WebRTC 실제 스피커 재생은 실행하지 않았다. 기존 Notify에는 송신 표본 ID가 없어 앱은 수신 표본 순번과 펌웨어의 새 RSSI 송신 보장을 조합한다. -60dBm/7초 임계값은 임시 기존값이며 현장 검증이 필요하다. 과거 실제 발화 녹음은 확인하지 않았다. Expo Android bundle 및 통합 build/lint는 후속 T5/T7 검증에 남긴다. Notion 최신 원문 접근은 이 작업에서 확보되지 않았으며 로컬 계약 밖의 새 API/DB 상태는 추가하지 않았다.

공식 참고: https://developers.openai.com/api/docs/guides/realtime-conversations (response metadata 대응); 출력 started/stopped/cleared의 response_id는 설치 OpenAI SDK Realtime 선언과 대조했다. API reference 대형 HTML은 조회 도구의 4MB 제한으로 열리지 않아 문서/설치 SDK를 함께 사용했다.


## 독립 검토 P2 보완 — 2026-09-23

`.agent-loop/T2-review.md`의 완료 뒤 새 STOP_REQUEST 경합을 실제 Alight 화면 + 실제 bell-stop-session + 실제 bell-command-sender 실행으로 재현하고 수정했다. T4 소유 dispatcher/guide/RouteList와 application/package/config에는 손대지 않았다.

수정 파일:
- `apps/mobile/src/screens/AlightScreen.js`: 이미 TRIP_DONE/CANCELLED인 focus는 벨 작업을 시작하지 않는다. TRIP_DONE effect는 미전송 작업을 조용히 취소한다. 운행 ID와 terminal 상태를 실시간으로 검사하는 canSend를 실제 세션에 전달한다. 조용히 취소된 미전송 요청은 FAIL 결과를 저장하지 않는다.
- `apps/mobile/src/ble/bell-stop-session.ts`: stopSending은 이후 물리 전송만 막는다. 아직 GATT write를 시작하지 않았으면 취소 표시로 끝내고, 시작한 write는 기존 Notify/결과 저장 수명을 유지한다.
- `apps/mobile/src/ble/bell-command-sender.ts`: 연결 확인/새 연결의 전후, Notify 구독 및 각 STOP write 직전에 canSend를 검사한다. 이미 시작한 GATT write가 완료되는 경계와 Notify 유효성은 terminal 상태로 무효화하지 않는다. 실패 뒤 재연결/두 번째 write는 canSend에 의해 막힌다. 기존 전체 5초 전송 예산과 전송 후 10초 Notify 예산은 유지한다.
- `apps/server/src/integration/mobile-alight-screen.test.ts`: 실제 화면 useEffect 수명을 실행하도록 harness를 보강하고 7개 terminal 회귀를 추가했다.

RED: `.agent-loop/T2-terminal-bell-red.log`, 새 초기 5개 중 4개 실패(이미 완료 focus, 연결확인 대기, 연결 대기, write 실패 뒤 재시도). 이미 시작한 write의 늦은 Notify 보존은 기존 동작에서 PASS였다.

GREEN: `pnpm --filter @bus-ta/server exec tsx --test src/integration/mobile-alight-screen.test.ts src/integration/mobile-bell-command-sender.test.ts src/integration/mobile-bell-stop-session.test.ts src/integration/mobile-riding-bell-lifecycle.test.ts src/integration/mobile-bell-connect-controller.test.ts` → **48/48 PASS**, `.agent-loop/T2-terminal-bell-suite.log`. 실제 Alight 12개에는 위 경합 외에도 재시도 연결 대기 중 완료, write ACK 이전/이후 완료 후 실제 Notify 보존, 이미 진행 중인 결과 저장 보존이 포함된다.

`pnpm typecheck` → shared/mobile PASS. server는 T4가 병렬 작업 중인 `mobile-multimodal-route.test.ts:40,53,54`의 optional response/instructions 타입 오류로 FAIL. `.agent-loop/T2-terminal-bell-typecheck.log`에 기록했고 Director에게 전달했다. 소유권 밖의 T4 파일은 수정하지 않았다. 따라서 이 보완 시점의 전체 typecheck PASS를 주장하지 않는다.

문서 동기화: FRONTEND_GUIDE가 T4 편집 범위와 겹칠 수 있어 보완 계약은 이 인계 문서에 기록했다. T4 편집 종료 후 `FRONTEND_GUIDE.md`의 Alight 항목에 다음을 통합하면 된다: “TRIP_DONE 이후 새 하차벨 연결·재시도·STOP 전송을 시작하지 않는다. 미전송 세션은 실패 저장 없이 취소하고, 이미 시작한 write의 진짜 Notify와 결과 저장은 유지한다.”

한계: 이미 호출한 native connect/GATT write 자체를 되돌리는 변경은 아니다. 완료 뒤 새로운 연결/물리 전송을 더 시작하지 않도록 경계를 막고, 이미 진행된 I/O 정리는 기존 운행 소유자 수명에 따른다. 실제 장치/실차 실행은 하지 않았다. 커밋·푸시·배포·운영 DB 변경 없음.
