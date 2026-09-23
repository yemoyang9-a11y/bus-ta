# T1 구현 인계 (2026-09-22)

## 범위와 구현

- 작업 폴더: `.worktrees/rehearsal-20260922`.
- 허용 파일: `hardware/smart-cane/ble_stick.ino`, `proximity-feedback.h`, `tests/proximity-feedback.test.cpp`, `README.md`, `scripts/test-cane-feedback.mjs`.
- 이전 구현자가 작성한 순수 PWM 제어기와 호스트 실행기를 이어받아 스케치 통합의 경합을 수정했다. 앱/서버/DB, 하위 `ble_stick/ble_stick.ino` 사본은 수정하지 않았다.
- GPIO25 `analogWrite` PWM. RSSI -90..-55를 0..255로 변환, 상승 600ms/하강 1200ms의 전체 범위 속도, 마지막 신호 1200ms 유예. loop의 약 20ms 주기이며 이전 LEAVING/PASSING과 무관하게 약한 재접근도 복구한다.
- controller/history/state/notifyGate는 loop 단일 소유. 명령 수락과 consume→observe/history→Notify→PWM 전체는 일반 FreeRTOS 태스크 mutex인 `FeedbackTransactions`로 직렬화한다. 명령은 수락할 때까지 잠금을 기다리고, loop는 tryLock 실패 시 그 주기의 출력을 건너뛴다. 잠금 순서는 output mutex→stateMux이며 scan callback은 stateMux만 사용한다. 짧은 critical section에서는 고정 크기 `ScanMailbox`만 접근하고 BLE 호출은 하지 않는다. START/STOP/타깃 명령은 매번 세대를 갱신하고 이전 pending 표본을 폐기한다.
- 스캔 시작 시 세대와 타깃을 함께 캡처한다. 완료 콜백의 결과 파싱·clearResults가 끝날 때까지 in-flight를 유지한다. 게시와 세대 재검증이 같은 잠금 안에서 수행되어 중간에 바뀐 타깃/명령의 결과가 게시되지 않는다. 결과 소비 전 다음 스캔도 금지한다.
- 1초 스캔은 callback overload를 사용한다. STOP에서 BLE stop/완료 경합을 만들지 않고 기존 스캔이 자연 종료하도록 하며, 모터는 다음 제어 주기에 감쇠 없이 0으로 전환한다. START/타깃 변경도 다음 주기에 출력과 필터를 초기화한다.
- 연결 해제 시 재광고. UUID·명령·Notify JSON·기존 상태 문자열 보존. 유효 상태가 나온 뒤 실제 관측 표본만 약 1초 간격으로 원시 RSSI Notify하며 누락 창에는 보내지 않는다.

## 검증

- `node scripts/test-cane-feedback.mjs`: **최종 19 PASS**, exit 0 (출력 chunk 860949). 격리 Zig 0.16.0 C++11 호스트 컴파일 및 실행. 최초 13개 구현 인계 당시 RED는 실행하지 않았으며, 아래 리뷰 P2 회귀는 RED→GREEN을 실행했다.
- 기존 8개: 거리 증가 후 재접근, 일시 누락/장기 소실, STOP/START/타깃 필터 초기화, uint32 wrap, 시간 역전, tick 주기 독립성, 긴 공백 후 출력 점프 억제, 새 RSSI Notify 게이트.
- 추가 5개: 스캔 도중 타깃 변경과 이전 세대 폐기, 게시 후 STOP에 pending 표본 폐기, 빠른 STOP→START/완료 소비 전 재시작 차단/스캔 시작 실패 복구, 명령 소비와 scan begin 사이 타깃 변경, 완전 소실 후 -82dBm 약한 재접근 복구.
- 리뷰 P2 추가 2개: (1) consume 이후 STOP/SET_TARGET이 끼어드는 결정적 순서에서 출력 transaction이 끝나기 전 수락을 차단, 이후 명령 적용 시 이전 표본 없음 확인, (2) 명령 transaction이 먼저 진행 중이면 출력 진입을 차단하고 pending RSSI 폐기 확인. 실제 firmware가 사용하는 `FeedbackTransactions`와 결정적 mutex 대역을 사용한다. 첫 pass-through transaction 구현(기존 분리된 경계를 재현)은 assert `!transactions.tryRun(...)`에서 exit 1로 실패(chunk ff96b5). mutex 적용 후 두 순서 모두 통과했다. 실 OS 병렬 스레드/무선 시험은 아니다.
- RAII 잠금 해제 도입 후 Zig의 `-nostdlib++` 빌드에서 예외 런타임 심볼 `_Unwind_Resume` 등이 링크되지 않았다. 이 순수 firmware 시험은 C++ 예외를 사용하지 않으므로 Zig 실행기에 `-fno-exceptions`를 추가하고 호스트 시험을 다시 통과시켰다.
- 실제 ESP32 컴파일: **최종 SDK 경계 P2/MTU 수정본 PASS, exit 0** (ASCII 드라이브 별칭, session 47473, chunk 89ae98). Arduino CLI 1.5.1 / Arduino-ESP32 3.3.12 / FQBN `esp32:esp32:esp32`. 스테이징 `.agent-loop/tools/sketch/ble_stick`, 출력 `.agent-loop/tools/esp32-build`. 성공 출력에 경고 없음. Flash 1,107,858 / 1,310,720 bytes (84%), global RAM 41,868 / 327,680 bytes (12%), local variables용 285,812 bytes 여유. 이전 session 99688/1908/27721은 중간 수정본 결과이며 최종 검증을 대신하지 않는다.
- 첫 빌드(session 34721)는 exit 1. 최종 링크에서 `ld.exe: cannot open output file .../ble_stick.ino.elf: No such file or directory`, `collect2.exe: error: ld returned 1 exit status`. 한국어 포함 경로가 깨져 출력 파일을 열지 못했다. 앱 ELF/BIN이 생성되지 않았으므로 성공으로 처리하지 않았다.
- `%TEMP%/cane-rehearsal-20260922` 정션으로 같은 폴더를 가리킨 시도도 exit 1. Arduino CLI가 `following symlink .../arduino-data/packages: The system cannot find the path specified`라고 보고하여 이 별칭으로는 플랫폼을 읽지 못했다.
- 다음 시도(session 99688)는 사용 중이 아닌 것을 확인한 `Q:`를 `subst Q: <worktree>`로 연결했다. 파일 이동·삭제 없이 동일 작업 폴더를 가리키는 임시 드라이브다. 환경변수 `ARDUINO_DIRECTORIES_DATA=Q:\.agent-loop\tools\arduino-data`, `ARDUINO_DIRECTORIES_DOWNLOADS=Q:\.agent-loop\tools\arduino-downloads`, `ARDUINO_DIRECTORIES_USER=Q:\.agent-loop\tools\arduino-user` 후 실행: `Q:\.agent-loop\tools\arduino-cli\arduino-cli.exe compile --fqbn esp32:esp32:esp32 --build-path Q:\.agent-loop\tools\esp32-build Q:\.agent-loop\tools\sketch\ble_stick`.
- 독립 검증자가 같은 명령으로 재현할 수 있도록 Q: 별칭은 인계 시 유지한다. 이번 worktree 매핑임을 `subst`로 확인한 뒤 검증 종료 시 `subst Q: /D`로 별칭만 해제할 수 있다. 실패한 `%TEMP%/cane-rehearsal-20260922` 정션도 이번 작업에서 생성한 별칭이며 원본 데이터는 이동하지 않았다.
- `git diff --check`: exit 0 (줄바꿈 변환 경고만 존재).

## 제한과 후속 확인

- 첫 리뷰 P2의 mutex 근거: Arduino-ESP32 3.3.12 `BLECharacteristic.cpp` 882–905의 confirmation 대기는 indication 전용이다. 같은 파일 380–382는 setValue 내부 잠금을 함수 안에서 해제하며 633–635는 onWrite 호출이 끝난 뒤 Write 응답을 보낸다. 이후 아래 SDK 경계 P2 수정에서 `setValue/notify(true)` 송신은 제거하고 직접 독립 payload 전송으로 바꿨다. 일반 mutex 경계는 유지하며 RTOS 지연 상한 측정은 아니다.
- 뮤텍스 생성 실패 시 setup이 GPIO25=0 상태에서 멈추고 BLE 초기화를 시작하지 않는다. 로그 `수신(처리 대기)`는 접수한 문자열의 도착이며, `요청 수락`은 output mutex를 잡아 mailbox를 바꾼 뒤에만 출력한다. 성공 수락 이후 이전 sample의 새로운 Notify/PWM 호출은 시작되지 않는다. 이미 BLE 스택에 맡긴 Notify의 무선 전송 완료 시점을 되돌리는 기능은 아니다.

- 기존 상태 계약상 NONE Notify를 보내지 않는다. 초기 상태는 최소 6개 표본, 안정된 근접 ARRIVED는 보통 8개 표본 이후이며, 약하고 변화 없는 신호에서는 더 지연될 수 있다. Director와 합의한 대로 이 초기 공백을 유지하고 T2 자동 탑승은 첫 유효 Notify 뒤 새 표본으로 확인한다.
- 호스트 시험은 mailbox의 결정적 이벤트 순서 재생이며 실 ESP32의 동시 스케줄러/무선 지연 시험이 아니다. 실제 모터 PWM·BLE 재연결·거리 왕복·약한 duty 구동은 기기 재시험이 필요하다.
- 스케줄링상 STOP/타깃 변경은 명령이 mailbox에 들어온 다음 loop 주기에 적용된다. 20ms는 nominal 주기이며 RTOS/라이브러리의 실시간 deadline을 보장한 측정치가 아니다.
- 플래시·커밋·푸시·배포는 하지 않았다. 독립 Tester/Reviewer 단계는 Director가 진행한다.

## SDK 공유 값 경계 P2 수정 (재시도 2)

- SDK는 regular Write에서 먼저 shared characteristic value를 바꾸고 onWrite를 호출한다(로컬 BLECharacteristic.cpp 619/635). 이 SDK 선행 쓰기는 앱 mutex로 보호할 수 없다. 송신의 characteristic `setValue/notify` 호출을 완전히 제거하고 `NotificationFrame` 로컬 JSON → `esp_ble_gatts_send_indicate(..., need_confirm=false)`로 분리했다. 기존 UUID·필드·상태 문자열은 유지한다.
- RX는 BLE 이벤트 태스크에서만 쓰는 characteristic value를 `getValue()`로 즉시 복사한다. regular Write와 prepared/EXEC_WRITE가 같은 two-arg onWrite를 다른 union 멤버로 호출하므로 raw `param->write`로 통일해 읽지 않았다. TX가 RX 저장소를 건드리지 않으므로 기존 single-arg 콜백의 RX 전용 복사가 두 SDK 경로를 보존한다. 준비된 쓰기 조립/취소는 기존 SDK에 맡긴다.
- 연결/해제/MTU 이벤트와 CCCD 변경을 기존 output mutex에서 처리한다. CCCD는 immutable GATTS WRITE payload의 connId와 descriptor handle을 확인해 연결별로 저장한다. SDK의 공유 BLE2902 값을 송신 게이트로 읽지 않는다. 연결 슬롯은 해당 코어의 CONFIG_BT_ACL_CONNECTIONS(4)에 맞춘다. 재연결/connId 재사용은 구독=false, MTU=23으로 초기화하며 새 구독이 필요하다.
- 등록 이벤트의 GATT interface, 현재 특성 handle, 해당 활성 connId를 사용한다. 연결 해제 callback은 같은 mutex에서 소유권을 제거한 뒤 재광고한다. 스택에 제출된 전송을 되돌리는 기능은 아니며 이미 물리적으로 끊긴 연결은 SDK의 연결 상태 검사에서도 거절한다.
- 각 연결의 구독과 `payload length <= MTU - 3`을 만족할 때만 JSON 전체를 전송하며 부족한 MTU에서는 잘라 보내지 않는다. 64바이트 버퍼/61바이트 payload 상한. 5개 enum과 -100/-55/INT32_MIN 시험에서 길이 30~45바이트를 확인했다(-100의 최대는38). 앱 MTU64 최소 조건과 일치한다. setup에서 local MTU185를 설정하고 실패하면 모터0/광고 미시작으로 중단한다.
- SDK buffer 소유권 근거: 설치된 esp_idf_version.h는 5.5.5. 동일 공식 태그의 [esp_gatts_api.c](https://github.com/espressif/esp-idf/blob/v5.5.5/components/bt/host/bluedroid/api/esp_gatts_api.c)는 send_indicate에서 btc_transfer_context에 deep-copy 함수를 넘기며, [btc_gatts.c](https://github.com/espressif/esp-idf/blob/v5.5.5/components/bt/host/bluedroid/btc/profile/std/gatt/btc_gatts.c) 77–82는 value_len만큼 별도 메모리에 복사한다. 읽기 확인용 사본은 `.agent-loop/tools/esp-idf-source-check/`에 있다. 따라서 호출 반환 후 스케치 로컬 JSON 버퍼의 수명이 끝나도 RX 저장소와 독립이다.
- 새 회귀 4개: 미소비 regular/prepared 명령이 TX로 덮이지 않음, JSON 구성/제출 사이 SDK Write가 와도 송신 bytes 보존, 연결별 CCCD·unsubscribe·disconnect·connId 재사용·MTU 경계에서 완전한 JSON만 허용, 모든 enum의 MTU64 크기. 공유 값에 set→notify하는 기존 경계 대역에서 첫 시험이 assert 실패(exit1, chunk28374c)했고 독립 sendRaw 경로로 바꾼 뒤19 PASS. 대역에 SDK 쓰기 시점을 주입한 결정적 시험이며 실기기 장거리 Write/MTU/무선 시험은 아니다.
- 검증 대상은 Arduino-ESP32 3.3.12 / ESP-IDF5.5.5 / Bluedroid에 한정한다. NimBLE 경로는 compile error로 거절한다. 다른 코어의 전체 스케치 호환성을 주장하지 않는다.
