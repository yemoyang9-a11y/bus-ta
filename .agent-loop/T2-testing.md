# T2 독립 시험 결과 — 2026-09-22

최신 판정: **2026-09-23 P2 보완 재시험 PASS**. 하단 재검증 절의 48/48 및 모바일 타입 검사 결과를 적용한다. 아래 201/201은 보완 이전의 별도 시험 기록이며 이번 48개와 합산하지 않는다.

판정: **PASS — T2의 로컬 실행 시험·모바일 타입 검사·실제 소비 경로 연결 범위.** 재현된 실패 없음. 실물 GPS/BLE/음성 출력 및 설치 성공 판정은 포함하지 않는다.

작업 위치: `C:\Users\yemoy\OneDrive\문서\한이음\.worktrees\rehearsal-20260922`. 독립 Tester가 직접 실행한 결과는 모바일 통합 **145/145**, Realtime·탑승 관련 **56/56**, 합계 **201/201 통과**다. 구현자의 전체 서버 416개/전체 scripts 66개 결과를 독립 재실행 결과로 옮겨 쓰지 않았다. 전체 서버/shared는 T4 병렬 변경 중이므로 이번에 전체 suite/typecheck를 반복하지 않았다.

T2 파일 freeze 상태에서 아래 시험과 소스 대조를 끝냈다. 이후 루트에 dispatcher/RouteList/guide의 T4 수정권한을 넘겨도 된다고 알렸다. 그 이후 T4 변경은 이 판정의 대상이 아니며 T4 단계에서 재검증해야 한다.

## 직접 실행한 명령과 결과

모바일 통합 시험, 작업 디렉터리 `apps/server`:

```powershell
$mobileTests = Get-ChildItem -LiteralPath src/integration -Filter 'mobile-*.test.ts' -File | ForEach-Object FullName
$testOutput = & node node_modules/tsx/dist/cli.mjs --test $mobileTests 2>&1
$testExit = $LASTEXITCODE
if ($testExit -eq 0) { $testOutput | Select-Object -Last 12 } else { $testOutput }
exit $testExit
```

결과: **145 tests / 145 pass / 0 fail, exit 0**. 도구 출력 chunk `8c021e`, test runner duration 약 4.26초. 알려진 Windows child-process 실행 제약을 피하기 위해 `require_escalated`로 실행했다.

Realtime 및 탑승 연관 시험, 작업 디렉터리 `apps/server`:

```powershell
$realtimeTests = Get-ChildItem -LiteralPath ../../scripts -File |
  Where-Object { $_.Name -like 'realtime*.test.mjs' -or $_.Name -like 'realtime*.test.ts' -or $_.Name -eq 'boarding-detector.test.mjs' -or $_.Name -eq 'exception-2-trip-transition.test.mjs' } |
  ForEach-Object FullName
$testOutput = & node node_modules/tsx/dist/cli.mjs --test $realtimeTests 2>&1
$testExit = $LASTEXITCODE
if ($testExit -eq 0) { $testOutput | Select-Object -Last 12 } else { $testOutput }
exit $testExit
```

결과: **56 tests / 56 pass / 0 fail, exit 0**. chunk `ac9ebf`, duration 약 0.78초. `require_escalated`로 실행했다.

모바일 타입 검사 및 변경 공백 검사, 작업 디렉터리 worktree root:

```powershell
node node_modules/typescript/bin/tsc --noEmit -p apps/mobile/tsconfig.json
git diff --check -- apps/mobile/src apps/server/src/integration scripts/realtime-response-queue.test.mjs scripts/realtime-completion.test.ts docs/FRONTEND_GUIDE.md docs/REALTIME_GUIDE.md docs/ARRIVAL_POLLING.md
```

결과: 각각 **exit 0**. 타입 진단 없음(chunk `203074`). diff 검사에는 Windows LF→CRLF 변환 예고만 있고 공백 오류 없음(chunk `729334`).

## 요구 조건 및 실제 연결 대조

| 범위 | 확인한 증거와 판정 |
| --- | --- |
| Riding→Alight GPS 유지 | 실제 `RealtimeProvider.tsx`와 `RidingScreen.js`를 불러 실행하는 `mobile-riding-bell-lifecycle.test.ts`에서 화면 blur 이후 GPS PATCH 유지, TRIP_DONE에서 구독 중지, 완료 Promise 종료 전 운행 보존, 종료 후 RESET 및 운행 소유 bell 해제를 확인했다. Provider가 실제 `trip-tracking.ts`를 생성하며 화면 이동 자체는 추적을 종료하지 않는다. PASS. |
| 늦은 위치/도착 응답 및 다음 운행 | `mobile-trip-tracking` 및 reducer/Provider 시험에서 이전 운행 응답 폐기, 탑승 뒤 WAITING 응답 폐기, requestId 충돌 방지, 완료 상태 회귀 방지를 확인했다. 같은 Riding 인스턴스에서 다음 운행의 Alight 이동도 다시 수행된다. PASS. |
| 완료 response ID와 실제 출력 종료 경계 | `realtime-completion.test.ts`가 실제 session 클래스를 실행한다. completionKey로 created를 연결하고 같은 response ID의 completed done + started + stopped를 모두 요구한다. done만 도착한 경우와 이전 응답 stopped는 종료 근거가 되지 않는다. PASS. |
| 완료 실패·늦은 created·다음 운행 | 출력 없는 유한 timeout, 전송 예외, 운행 취소, timeout 이후 늦은 created의 정확한 response 취소, 늦은 출력 clear, cleared 이후 다음 운행 큐 재개를 실제 session 시험으로 확인했다. 실제 Provider 시험에서는 연결이 없을 때 로컬 TTS의 onDone까지 RESET을 기다린다. 로컬 TTS timeout/abort도 별도 시험으로 확인했다. PASS. |
| 자동 탑승의 실제 Provider 소비 | Provider effect가 `subscribeCaneState`→실제 automatic controller→기존 boarding detector→confirmBoarding API를 연결한다. 실제 Provider 시험에서 API 성공 전 WAITING 유지와 성공 후 ON_BUS 반영, 수동 확정/취소/다음 운행 중 늦은 자동 응답 폐기를 확인했다. helper 단독 판정이 아니다. PASS. |
| 새 RSSI 표본 및 자동 재시도 | controller 시험에서 설정 타깃의 새 유효 표본만 7초 조건에 사용하고 중복/늦은 표본·NaN·취소 후 callback을 거절한다. 실패는 같은 requestId로 최대 3회 시도하고 서버 성공 없이 앱 탑승 상태를 바꾸지 않는다. 소스는 timestamp의 증가/최대 나이 4초/미래값과 optional sampleId 증가도 검사한다. PASS, 아래 표본 출처 한계 참조. |
| 지팡이 준비·취소·소유권 | prepare controller 시험이 최대 3회 연결 및 1/2초 간격, 실패/throw, 취소 중 pending 연결의 늦은 완료, 탑승 후 START 차단, 이전 소유자 해제 실패 시 새 타깃 덮어쓰기 차단을 확인한다. 실제 Provider는 해당 준비 controller를 생성하고 운행/탑승 effect에 연결한다. PASS. |
| STOP 실패 및 disconnect 실패 | release controller는 STOP 성공 후에만 disconnect한다. STOP 전부 실패 시 연결을 유지하는 시험과, 실제 bleManager 소스를 실행하여 disconnect reject 뒤 기존 연결로 STOP 재전송이 가능한 시험이 통과했다. PASS. |
| MTU | 실제 bleManager VM 시험에서 185 협상 성공, 23으로 부족, requestMTU reject를 실행했다. 실제 소스는 `requestMTU(185)` 결과가 유한하고 `mtu >= 64`인 경우에만 서비스 탐색/연결 채택하며 실패 연결을 정리한다. PASS, 정확한 63/64 경계값 실행은 아래 공백 참조. |
| adaptive arrival | 서버 지연값 60000ms 적용과 응답마다 단일 timeout 재예약, 0→1000ms, 잘못된 값→15000ms, 오류 뒤 15000ms 재예약 및 GPS 유지, 탑승/취소/운행 변경 후 재예약 중단을 실행했다. PASS. |
| Alight 저장 재시도 및 완료 경합 | 실제 `AlightScreen.js`와 실제 bell session을 실행하는 시험에서 POST 2회 실패 후 3번째 성공에도 물리 STOP 요청은 1회임을 확인했다. 완료보다 늦은 저장은 상태/벨 성공 음성을 복원하지 않는다. 실제 소스는 저장 재시도에 동일 body/timestamp를 사용하고 운행·세대·TRIP_DONE을 재확인하며 terminal bell 오류는 재시도하지 않는다. PASS. |
| Alight 홈 종료 | 실제 화면 시험에서 end API 성공 전 초기화하지 않고 실패 시 운행을 보존한다. 이전 운행 요청의 늦은 응답도 새 운행을 지우지 않는다. PASS. |
| Function 및 후보 안내 | dispatcher 시험에서 정확한 무인자 목록의 공백 허용, 목록 밖 빈 입력 및 null/배열/깨진 JSON 거절, 중복/동시 호출 경계, 후보 소진/만료, 기존 routeNoSpoken 유지가 통과했다. 실제 session의 중복 call 제거와 dispatcher 연결을 소스로 대조했다. T4 인계 이전 상태에 대한 PASS. |

## 시험의 범위와 남은 공백

- Provider/Riding/Alight 시험은 **실제 소스를 transpile하여 VM의 hook harness로 실행**한다. 실제 추적/자동 탑승/controller와 reducer를 사용하는 경로를 검사하지만 React Native renderer, navigation framework, Location/BLE native IO, 네트워크는 대체된다. Provider harness의 session과 assist preparation도 대체되고, 이들의 실제 클래스/controller는 별도 시험으로 실행한다. 따라서 전 경로가 동시에 실제 장치에서 실행됐다는 뜻은 아니다.
- MTU의 정확한 **63 거절 / 64 허용** 값은 기존 자동 시험에 없다. 현재 비교식과 23/185/협상 실패 경로는 확인했다. 실제 Android 협상값·실물 Notify 프레임 수신은 미검증이다.
- 앱의 `sampleId`는 수신 순번이고 timestamp도 수신 시각이다. 소스의 optional sampleId 단독 중복 분기는 명시적인 별도 시험이 부족하다. 송신 표본 ID가 없는 현재 JSON으로 실제 펌웨어 표본의 신선도까지 앱 단독으로 입증할 수 없다. 새 RSSI만 보내는 펌웨어 동작 및 -60dBm/7초 임계값의 현장 검증은 별도다.
- 실제 휴대폰 GPS 주기, 백그라운드/포그라운드 전환, 물리적 자동 탑승, BLE 연결 유지, WebRTC 스피커 출력과 TTS 중단은 실행하지 않았다. 서버 이벤트를 주입한 response ID 상관 시험을 실제 스피커 재생 검증으로 표현하지 않는다.
- terminal bell 오류 무재시도 및 일부 세대/타임아웃 정리는 소스 대조를 포함한다. 모든 네이티브 이벤트 순서·조합을 자동 시험이 망라하지 않는다.
- Android 설치/Expo bundle, 전체 프로젝트 build/lint, 병렬 T4 변경 이후의 전체 회귀 검사는 이번 T2 독립 시험에 포함하지 않았다. 구현자 전체 416/66/typecheck 로그는 참고 증거이며 이번 직접 실행 결과와 구분한다.

## 수정 파일 및 결론

Tester가 작성한 파일은 **`.agent-loop/T2-testing.md` 하나**다. 앱/서버/펌웨어/마이그레이션/패키지 소스 수정, DB 작업, 커밋/푸시/플래시 없음.

위 로컬 범위에서 T2는 **PASS**, 독립 Reviewer 검토로 넘길 수 있다. 실물 리허설 및 이후 T4 변경의 회귀 검증은 별도 완료 조건으로 남는다.

## 2026-09-23 — Reviewer P2 보완 독립 재검증

배경: 기존 201개 시험 이후 Reviewer가 `.agent-loop/T2-review.md`에서 **완료 후 새 STOP_REQUEST가 시작되는 경합**을 발견했다. 따라서 기존 PASS만으로 이 경합의 해결을 주장하지 않는다. 이번에는 구현 보고 마지막 보완과 최종 소스 네 파일을 읽고, 실제 화면→실제 세션→실제 sender를 사용하는 보완 시험을 독립 실행했다.

대상:

- `apps/mobile/src/screens/AlightScreen.js`
- `apps/mobile/src/ble/bell-stop-session.ts`
- `apps/mobile/src/ble/bell-command-sender.ts`
- `apps/server/src/integration/mobile-alight-screen.test.ts`

직접 실행, 작업 디렉터리 `apps/server`:

```powershell
$testOutput = & node node_modules/tsx/dist/cli.mjs --test src/integration/mobile-alight-screen.test.ts src/integration/mobile-bell-command-sender.test.ts src/integration/mobile-bell-stop-session.test.ts src/integration/mobile-riding-bell-lifecycle.test.ts src/integration/mobile-bell-connect-controller.test.ts 2>&1
$testExit = $LASTEXITCODE
if ($testExit -eq 0) { $testOutput | Select-Object -Last 12 } else { $testOutput }
exit $testExit
```

**48 tests / 48 pass / 0 fail / 0 cancelled / 0 skipped / 0 todo, exit 0**, duration 2104ms, 직접 실행 출력 chunk `d54e83`. `require_escalated` 실행. 최초 동일 실행도 exit 0이었으나 주입된 오류 경로의 로그가 길어 출력이 잘렸으므로, 최종 집계를 확인하도록 출력만 압축한 위 명령으로 재실행했다. 로그의 `write failed`/`BELL_SEND_NO_LONGER_ALLOWED`는 실패 경로를 주입하는 시험에서 발생한 것이며 test runner 실패가 아니다.

worktree root에서 별도 실행:

```powershell
node node_modules/typescript/bin/tsc --noEmit -p apps/mobile/tsconfig.json
git diff --check -- apps/mobile/src/screens/AlightScreen.js apps/mobile/src/ble/bell-stop-session.ts apps/mobile/src/ble/bell-command-sender.ts apps/server/src/integration/mobile-alight-screen.test.ts
```

모바일 타입 검사 **exit 0, 진단 없음**(chunk `d79c59`). 보완 파일 diff 검사 **exit 0, 출력 없음**(chunk `a0e524`). 전체 typecheck는 T4 병렬 수정이 끝난 뒤 통합 단계에서 실행할 범위이므로 여기서 반복하지 않았다. 구현 보고의 이전 T4 server 타입 오류를 이번 T2 실패나 전체 현재 PASS로 바꾸어 기록하지 않는다.

### 경합별 실제 실행 결과

| 경계 | 확인한 결과 |
| --- | --- |
| 이미 TRIP_DONE인 Alight focus | 연결 확인 0, 연결 0, STOP 0, POST 0. 미전송 취소를 FAIL 결과로 저장하지 않음. PASS. |
| 연결 상태 확인 pending→TRIP_DONE→늦은 false | 뒤늦게 연결을 시작하지 않으며 STOP 0, POST 0. PASS. |
| Alight의 연결 pending→TRIP_DONE→연결 resolve | 연결 시작 1회 후 완료 상태로 변경해 resolve시켜도 STOP 0, POST 0. Reviewer의 핵심 경합을 실제 화면/세션/sender로 실행. PASS. |
| write 시작→TRIP_DONE→write reject | 연결 확인 횟수가 늘지 않고 새 연결 0, STOP 총 1회. 완료 후 재시도 없음. PASS. |
| 첫 write 실패→재연결 pending→TRIP_DONE→연결 resolve | STOP 총 1회로 유지되어 두 번째 전송 없음. PASS. |
| write 시작→TRIP_DONE→ACK→SUCCESS Notify | STOP 총 1회, 원 운행 결과 저장 보존, 상태 dispatch 0, 벨 성공 음성 0. PASS. |
| write 시작→TRIP_DONE→ACK보다 먼저 SUCCESS Notify | 진짜 write 이후 들어온 Notify를 원 운행에 저장하고 뒤늦은 ACK가 재전송을 만들지 않음. PASS. |
| 진행 중인 POST→TRIP_DONE→POST resolve | 원 운행 저장은 유지하되 상태 회귀와 완료 뒤 벨 성공 음성을 만들지 않음. PASS. |
| 결과 POST 네트워크 재시도 | POST 3회, 물리 STOP 1회. 결과 저장과 물리 재전송을 분리. PASS. |
| 운행 A→B 이후 A의 늦은 Notify/write | A의 callback이 B의 상태·구독·결과를 변경하지 않으며 B의 Notify만 B에 저장됨. PASS. |
| 기존 수명과 시간 예산 | 중복 start/focus, 구독 정리, 5초 전송 예산, 전송 후 10초 Notify 예산, Provider/Riding 운행 이동 관련 회귀를 포함한 48개가 통과. PASS. |

### 소스 대조 및 범위

Alight는 terminal focus를 막고 TRIP_DONE effect에서 `stopSending()`을 호출한다. 실제 세션에 전달하는 `canSend`는 최신 운행 ID와 TRIP_DONE/CANCELLED를 검사한다. sender는 연결 확인과 연결의 전후, Notify 구독 전, 각 write 직전에 이를 검사한다. 반면 이미 시작한 write 이후의 ACK/Notify 유효성은 `canSend`로 무효화하지 않아 물리적으로 이미 수행된 요청의 결과를 보존한다. session의 `writeStarted` 이전에만 조용한 취소 표시를 반환하고 Alight는 이 취소를 POST하지 않는다.

현재 POST 저장의 `isCurrent`는 TRIP_DONE을 배제하지 않으며, 저장 이후 상태 조회/dispatch/음성 경계에서는 TRIP_DONE을 배제한다. 이 구분이 완료 후 새 물리 명령은 차단하면서 이미 수행된 요청의 실제 결과는 저장하는 요구와 맞는다. 운행 교체/취소/blur의 generation 및 운행 ID 검사는 별도로 유지된다.

실행된 경합 시험은 실제 Alight 소스, 실제 bell-stop-session, 실제 bell-command-sender를 함께 사용하고 BLE 연결·GATT·Notify 및 API는 제어 가능한 대체 I/O다. `useEffect`와 focus 수명을 harness에서 실행하며, TRIP_DONE은 상태 변경으로 주입한다. Riding의 PENDING 화면 이동과 Provider의 완료 수명은 같은 명령의 별도 시험에서 확인한다. 물리 장치, 실제 서버 POST, GPS→React Native navigation→BLE 전체 실물 시나리오를 하나의 실제 런타임에서 수행한 증거는 아니다.

이미 호출한 native connect/GATT write 자체의 철회는 보완 범위가 아니다. CANCELLED focus의 별도 신규 자동 사례는 없지만 동일 terminal focus 조건과 전송 `canSend` 조건을 소스로 확인했다. 실물 한계, MTU 경계 등 앞 절의 미검증 항목은 계속 유지한다.

재검증 판정: **PASS — Reviewer P2의 로컬 경합 회귀 범위**. 별도 Reviewer가 수정 사항을 재검토할 수 있다. Tester의 유일한 수정은 이 보고서이며 앱/시험 소스 수정, 커밋/푸시/플래시/DB 변경은 하지 않았다.
