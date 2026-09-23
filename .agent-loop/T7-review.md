# T7 최종 독립 통합 검토 — 2026-09-23

## 최종 판정

- **명세 충족: APPROVE**
- **코드 품질: APPROVE**

기준 `57e50ea` 이후의 tracked 변경과 새 소스·migration·시험·runner, T1~T6 구현/독립 시험/검토 기록 및 T7 최종 검증을 대조했다. 최초 검토에서 T3의 “최초 저장 결과 우선”과 모바일 화면·음성이 어긋나는 P2 한 건을 발견했으나, 좁은 수정과 독립 재시험 뒤 해소됐다. 최종 동결 소스에서 남은 P1/P2 결함은 찾지 못했다.

## 발견 후 해소된 P2

### 하차벨의 물리 결과가 서버 최초 확정 결과보다 먼저 UI·음성을 결정함 — 해소

초기 T7 소스에서는 `apps/mobile/src/screens/AlightScreen.js`가 물리 세션 결과를 받자마자 `setBellOutcome(outcome)`으로 화면을 확정하고, `POST /bell/result`의 응답은 버린 뒤 로컬 TTS도 제출한 `result`를 기준으로 골랐다. 따라서 DB에 최초 `SUCCESS`가 저장된 상태에서 늦은 물리 `FAIL`이 오면 서버 RPC와 최신 상태는 `SUCCESS`를 반환해도 화면과 로컬 음성은 실패라고 안내할 수 있었다. 역방향도 같았다. 이는 `apps/server/src/services/trip/bell-result.service.ts:125-140` 및 `supabase/migrations/20260922091013_atomic_bell_result.sql`의 최초 결과 우선 계약과 직접 충돌했다.

수정본은 `apps/mobile/src/screens/AlightScreen.js:79-82`에서 물리 callback이 저장만 시작하고 UI를 확정하지 않으며, `:128-159`에서 저장 성공 뒤 최신 GET과 운행/세대/terminal 경계를 통과한 `latestStatus.bellStatus`의 `SUCCESS | FAIL`만 화면, Realtime 알림, 로컬 TTS의 단일 근거로 사용한다. `TRIP_DONE`, `CANCELLED`, `PENDING`, POST/GET 실패 및 blur 뒤 늦은 응답은 성공·실패를 확정하지 않는다.

회귀 시험은 `apps/server/src/integration/mobile-alight-screen.test.ts:249-292`에서 최초 SUCCESS/물리 FAIL과 최초 FAIL/물리 SUCCESS 양방향, 저장·조회 실패, PENDING, TRIP_DONE/CANCELLED, GET 지연 및 Realtime 전달을 고정한다. 독립 Tester가 실제 Alight 소스와 실제 bell stop session/sender를 사용하는 집중 **21/21**, 추가 역방향·terminal Realtime 경계 **3/3**, root typecheck(workspace+scripts)와 lint를 모두 통과시켰다. 이 P2는 해소된 것으로 판정한다.

## 단계 간 계약 확인

1. **지팡이 → 앱 자동 탑승:** 펌웨어는 새 타깃 스캔 결과만 제한 주기로 Notify하고 신호 소실 때 마지막 RSSI를 재전송하지 않는다. 앱은 MTU 185를 요청하고 64 미만을 거절하며, 현재 운행·현재 타깃·최대 4초·단조 timestamp/sampleId 표본만 `apps/mobile/src/realtime/automatic-boarding.ts:24-52`의 기존 -60dBm/7초 판정기에 넣는다. 서버 성공 전 앱 상태를 바꾸지 않고 같은 requestId로 최대 3회 재시도한다. 초기 6~8표본 `NONE` 동안 Notify가 없는 것은 보존하기로 한 기존 계약이며 실제 RF 성공 증거와 구분한다.
2. **STOP과 장치 소유권:** 탑승·취소·운행 교체 때 지팡이 START를 더 진행하지 않는다. `apps/mobile/src/ble/cane-release-controller.ts:2-14`는 STOP 성공 뒤에만 disconnect하고, STOP 또는 disconnect 실패 시 소유권을 보존해 다음 해제 시도가 가능하다. Alight는 완료 뒤 새 연결·STOP·재전송을 막되 완료 전에 이미 시작한 write의 진짜 Notify와 저장은 보존한다.
3. **Riding → Alight 추적과 완료 음성:** Provider가 운행 단위 controller를 소유하므로 화면 이동으로 GPS watch가 끝나지 않는다. `apps/mobile/src/realtime/trip-tracking.ts:36-50,67-84`는 terminal 회귀와 늦은 응답을 차단하고 완료 전에 poll/watch를 정리한다. `apps/mobile/src/realtime/session.ts:95-163`은 completion metadata로 생성된 response ID와 같은 응답의 completed·audio started·stopped를 모두 요구하며, timeout/취소/늦은 생성은 폐기하고 로컬 TTS 대체를 유한하게 끝낸다. 다음 운행은 이전 운행 완료나 위치 응답에 의해 지워지지 않는다.
4. **원자적 하차벨 저장:** migration과 repository/service는 `trip_status` 다음 현재 `bell_logs` 순서로 잠그고, 두 UPDATE를 한 함수에서 처리한다. 최초 결과와 메시지가 권위 있고 legacy 부분 기록을 복구하며 CANCELLED/TRIP_DONE을 되돌리지 않는다. 함수는 security invoker·빈 search_path·service_role 전용이고, repository는 RPC의 outcome/ID/status 모양을 검증한다. 최신 요청이 아닌 과거 요청의 409 정책과 모바일 terminal 오류 처리가 맞는다.
5. **환승 안내와 운행 생성 차단:** 기본 검색은 `DIRECT_BUS`, 명시적 `ROUTE_SEARCH_SCOPE=MULTIMODAL`에서만 버스가 포함된 혼합 후보를 추가한다. 공개 `segments`에는 문자열 mode와 구간 정보만 있고 ODsay 내부 숫자는 노출되지 않는다. 환승 후보는 전체 구간을 결정적으로 안내하지만 `tripSupported=false`이며 RouteList, Realtime Dispatcher, 서버 CreateTrip schema의 세 경계에서 운행 생성을 막는다. 서버가 검색 이력을 저장하지 않아 metadata를 모두 제거한 조작 요청의 provenance를 증명하지 못하는 한계는 문서에 그대로 남아 있다.
6. **안내·도착 조회·후보 상태:** 모델 전용 노선 발음은 공개 API 필드와 분리되고, 후보 안내 완료는 response.done만이 아니라 실제 오디오 종료 뒤 기록된다. adaptive GET은 서버 `nextArrivalRefreshInMs`를 사용하며 WAITING_BUS를 벗어난 뒤 옛 도착정보와 늦은 WAITING 응답을 폐기한다. T4의 Dispatcher/guide/RouteList 변경이 T2 Provider/session/BLE/tracking 수명을 되돌리지 않았다.
7. **CI와 실행 계약:** root `typecheck`가 workspace 뒤 `tsconfig.scripts.json`의 세 TypeScript runner를 검사하고, CI는 같은 root 명령과 lint/build/server/scripts/C++를 호출한다. Node/pnpm 요구와 lock, 서버 `main` 산출물 경로가 맞다. SQL job은 fresh PostgreSQL에서 `service_role NOLOGIN BYPASSRLS`를 만든 뒤 boarding migration/race와 bell rollback·ACL·실제 다중 세션 lock 경합을 순서대로 실행한다.

## 검증 근거

- 최종 서버 전체 **471/471 PASS**, 보안 **7/7** 및 audit PASS.
- T7 P2 독립 집중 **21/21 PASS**, 추가 경계 **3/3 PASS**, root typecheck와 lint PASS.
- T5 보완 뒤 scripts **68/68 PASS**와 scripts TypeScript의 TS2304/TS2322 거부 확인.
- 변경 영향이 없는 C++ 호스트 **19 PASS**, 실제 PostgreSQL rollback/ACL 및 4개 lock 경합 PASS, shared/server build PASS.
- Android export는 최종 화면 수정 뒤 1,064 modules, 17 assets, HBC 3,044,809 bytes로 완료됐다. 독립 Tester는 로그·산출물·시각을 대조했으나 입력 hash manifest가 없어 현재 소스와 HBC의 암호학적 동일성까지 주장하지 않는다.

동일한 전체 묶음은 Reviewer가 다시 실행하지 않았다. 단계별 독립 기록, 최종 소스, 최종 검증 로그와 P2 집중 재시험을 서로 대조했다.

## 공개된 충돌과 남은 검증 한계

오래된 Notion의 직행 전용 검색/모든 반환 후보 생성 가능 문구는 현재 `MULTIMODAL` 안내 전용 설계와 충돌한다. 사용자가 이번 요청에서 최근 방향과 최신 코드를 기준으로 삼으라고 확정했으므로 blocker로 보지 않았고, 향후 Notion 동기화 필요성은 결과 문서에 공개돼 있다.

실제 ESP32 prepared Write·MTU/CCCD 재연결·모터 duty·RF 거리, Android 설치와 실제 BLE/GPS/WebRTC/스피커, 실제 ODsay/GBIS/Kakao/OpenAI 응답, 보호 Realtime 200, 운영 Supabase migration/권한 및 배포는 미검증이다. 로컬 host/VM/빌드/격리 PostgreSQL 검증을 실물 완주나 운영 성공으로 확대하지 않는다.

Reviewer가 수정한 파일은 이 리뷰 문서 하나다. 제품 코드, 시험, Git 인덱스, DB, 커밋, 푸시 및 배포는 변경하지 않았다.
