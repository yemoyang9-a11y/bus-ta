# T1 독립 재검토 (2026-09-22)

## 판정

- **명세: APPROVE** — T1 로컬 구현 범위에서 요구한 점진적 PWM, 신호 소실 뒤 약한 재접근, 명령/타깃 초기화, 새 원시 RSSI Notify, 재광고 및 기존 UUID·명령·JSON 계약을 코드와 시험에서 확인했다.
- **코드 품질: APPROVE** — 앞선 두 P2 경합의 발생 경로가 닫혔고, 이번 diff에서 추가 중대 결함을 찾지 못했다.
- 이 판정은 Arduino-ESP32 3.3.12 / ESP-IDF 5.5.5 / Bluedroid 로컬 구현과 빌드에 한정한다. 펌웨어 플래시, 실제 모터·무선·앱 연동 및 RTOS 타이밍 검증은 완료되지 않았다.

## 핵심 확인

1. **consume 이후 STOP/타깃 변경 경합:** `hardware/smart-cane/ble_stick.ino:469-479`는 `consumeScanUpdate()`와 `updateMotorFeedback()`를 하나의 `FeedbackTransactions` 경계에 둔다. `:385-409`의 명령 수락도 같은 일반 mutex를 사용한다. 명령이 먼저 수락되면 mailbox의 구 표본을 폐기하고, 출력이 먼저 시작됐으면 Notify와 PWM 호출이 끝난 뒤 명령이 수락된다. `proximity-feedback.h:82`의 RAII 해제와 `tests/proximity-feedback.test.cpp:260-341`의 두 결정적 순서 시험을 확인했다. `stateMux`는 mailbox의 짧은 작업에만 쓰며 BLE 호출을 그 critical section 안에서 실행하지 않는다.
2. **공유 characteristic RX/TX 경합:** `ble_stick.ino:193-204`는 더 이상 characteristic `setValue/notify`를 사용하지 않고 독립 JSON 버퍼를 `esp_ble_gatts_send_indicate(..., false)`로 보낸다(`:75-82`). `:364-370`의 수신 callback은 SDK가 regular Write 또는 prepared EXEC_WRITE를 마친 characteristic 값을 즉시 복사하므로 TX가 명령을 덮지 않는다. `proximity-feedback.h:10-77`과 신규 시험 `tests/proximity-feedback.test.cpp:342-369`에서 양쪽 이벤트 순서의 바이트 보존을 확인했다. 로컬 ESP-IDF 5.5.5 참고 소스 `esp_gatts_api.c:329-330`, `btc_gatts.c:77-89`는 전송 호출 중 payload deep copy를 수행한다.
3. **연결별 Notify:** `ble_stick.ino:223-260`은 connect/disconnect/MTU 및 CCCD Write 이벤트를 연결 ID별로 기록한다. `proximity-feedback.h:20-77`은 구독 중이며 전체 JSON이 `MTU - 3`에 맞는 연결에만 전송한다. `ble_stick.ino:428-432`는 광고 전에 로컬 MTU185 설정을 요구한다. connId 재사용 시 구독과 MTU를 초기화한다. 앱의 지팡이 연결 경로도 MTU185를 요청하고 64 미만을 거부한다. 신규 시험은 구독·해제·재사용·MTU 경계와 5개 상태의 전체 JSON 크기를 검사한다.
4. **기존 동작과 수명:** `ScanMailbox`는 완료 callback이 결과를 읽고 `clearResults()`를 마칠 때까지 이전 스캔을 소유하고 세대 불일치 결과를 버린다. PWM 제어기와 Notify gate는 loop 단일 소유다. 초기 최소 6~8개 표본의 `NONE` Notify 공백은 명시된 기존 계약으로 유지한다.

## 검증과 남은 확인

- 독립 Tester가 최종 소스로 호스트 시험 **19 PASS, exit 0**을 직접 실행했고, 최종 스테이징 해시와 같은 원본으로 ESP32 빌드 **session 47473, exit 0** 및 ELF/BIN을 확인했다. 이전 13/15개 시험과 빌드 session 99688/1908/27721은 중간 소스 결과로 구분했다. Reviewer는 시험·빌드를 반복 실행하지 않았다.
- 호스트 시험은 실제 SDK 이벤트·무선 수신·FreeRTOS 스케줄러를 실행하지 않는다. 앱 구독/MTU 협상, 재연결, STOP/타깃 변경, 느린 거리 왕복, PWM 최소 구동 duty 및 회로는 실물에서 확인해야 한다. 이미 스택에 제출된 Notify의 무선 전달 완료는 새 명령으로 취소할 수 없다.
- 수정한 파일은 이 리뷰 문서 하나다. 펌웨어·시험·Git 인덱스는 변경하지 않았다.
