# T1 독립 시험 결과 (2026-09-22)

## 판정

- 호스트 시험: **최종 SDK 공유 버퍼 P2/MTU 수정본 PASS — 19개 실행, 종료코드 0** (독립 실행 출력 chunk `261a09`).
- ESP32 정식 빌드: **최종 SDK 공유 버퍼 P2/MTU 수정본 PASS — Arduino-ESP32 3.3.12, ESP-IDF 5.5.5, Bluedroid, `esp32:esp32:esp32`, 종료코드 0**. 구현자가 실행한 session `47473`의 보존된 출력·종료코드, 새 ELF/BIN, 빌드 옵션, 원본/스테이징 해시를 독립 확인했다. 소스가 일치하므로 Tester는 중복 빌드를 하지 않았다.
- T1 로컬 검증 종합: **PASS, Reviewer 재검토 가능**. 최종 수정본의 실행한 시험에서 재현된 결함 없음. 이 판정은 실제 장치 완료를 뜻하지 않는다.
- 이전 13개/15개 호스트 시험 및 ESP32 session `99688`/`1908`/`27721`은 중간 수정본 기록이다. consume 이후 명령 수락 경합과 SDK shared characteristic 값의 RX/TX 경합은 최종 19개 시험 및 SDK/스케치 정적 연결 검토로 다시 확인했다. 실제 무선 SDK 이벤트의 동적 검증 범위는 아래 공백 항목과 구분한다.
- 실제 장치: **미검증**. 이번 작업에서 플래시, 모터 회로 조작, BLE 무선·앱 연동 시험을 하지 않았다.
- Tester는 애플리케이션·펌웨어·기존 시험 코드를 수정하지 않았다. 이 결과 문서만 작성한다.

## 범위와 확인한 파일

작업 폴더는 `C:\Users\yemoy\OneDrive\문서\한이음\.worktrees\rehearsal-20260922`이며 `git rev-parse --show-toplevel`로 확인했다. 기준은 `.agent-loop/T1-testing-brief.md`, `T1-implementation.md`, `CURRENT_TASK.md` 및 실행 계획의 T1이다. 최신 Director 지시에 따라 이 파일을 결과의 단일 기록으로 사용한다. brief에 적힌 별도 `T1-test-report.md`는 중복 생성하지 않는다.

검토한 T1 변경 파일:

- `hardware/smart-cane/ble_stick.ino` (수정)
- `hardware/smart-cane/README.md` (수정)
- `hardware/smart-cane/proximity-feedback.h` (새 파일)
- `hardware/smart-cane/tests/proximity-feedback.test.cpp` (새 파일)
- `scripts/test-cane-feedback.mjs` (새 파일)

README, `.env.example`, 관련 실행 계획과 하드웨어 문서를 먼저 확인했다. 전역 작업본에는 다른 문서 작업도 있으므로 그것을 T1 구현자가 수정한 파일로 간주하지 않는다. 새 untracked 헤더·시험·실행기를 모두 직접 읽었으며 tracked diff만으로 검토 범위를 제한하지 않았다.

## 직접 실행한 검증

| 명령 | 종료코드 | 결과 |
| --- | --- | --- |
| `node scripts/test-cane-feedback.mjs` (이전 기본 sandbox 실행) | 1 | 격리 `zig.exe`의 `spawnSync ... EPERM`. 컴파일러 시작 권한 문제이며 시험 assertion 실패가 아니다. 최종 검증은 알려진 제한 때문에 바로 `require_escalated`로 실행했다. |
| `node scripts/test-cane-feedback.mjs` (`require_escalated`) | 0 | **`proximity-feedback tests: 19 PASS`**. 최종 수정 후 호스트 C++ 컴파일과 실행 완료. 이전 검증은 13/15 PASS였다. |
| `git diff --check -- hardware/smart-cane scripts/test-cane-feedback.mjs` | 0 | T1 범위 whitespace 오류 없음. 하드웨어 두 파일의 LF→CRLF 변환 경고가 있다. 최초 전체 `git diff --check`도 exit 0이었으며 이번 재검증은 동시 진행 중인 앱/서버 작업을 검사 범위에 넣지 않았다. |
| `git status --short -- hardware/smart-cane scripts/test-cane-feedback.mjs` | 0 | 위 두 수정 파일과 세 신규 파일/경로 확인. |
| canonical `.ino`/header 및 스테이징 사본의 `Get-FileHash -Algorithm SHA256` | 0 | 아래 두 소스는 스테이징 사본과 각각 동일. |
| 빌드 로그·`build.options.json` 읽기, 최종 ELF/BIN `Get-Item` | 0 | session `47473`의 exit 0 기록, FQBN/ESP32 3.3.12, ELF 11,850,208 bytes 및 BIN 1,108,000 bytes 확인. |

호스트 실행기는 `-std=c++11 -Wall -Wextra -nostdinc++ -nostdlib++ -fno-exceptions`로 `.agent-loop/tools/zig-x86_64-windows-0.16.0/zig.exe c++`를 사용한다. P2 수정에서 RAII 잠금 해제가 추가된 뒤 Zig의 예외 런타임 의존을 피하도록 `-fno-exceptions`가 추가된 것을 확인했다. 시험 executable은 임시 폴더에서 실행 후 정리한다. 성공한 컴파일의 stderr는 러너가 별도 출력하지 않으므로 성공 컴파일러 경고 전체를 검사했다고 주장하지 않는다. 실행 결과는 assert 19개 함수가 모두 반환한 뒤 출력되는 요약이며 단순 문자열 존재 검사가 아니다.

소스 SHA256:

| 파일 | SHA256 |
| --- | --- |
| `ble_stick.ino` | `12376ED161CCF4A71DEA00014A18C67C10DE19E43C103B013C6FF251A1D5C7D8` |
| `proximity-feedback.h` | `68FAFBA7D2B94F8897698DAA3616B163A3BA06BE580B77C05492468F6D7FFA8B` |
| `tests/proximity-feedback.test.cpp` | `0D5B581B88906A54CD404BF8BCEFE00B747BF5652838685F69746402455BD902` |
| `scripts/test-cane-feedback.mjs` | `B388A62C08F0E9F03A47A2E8A252CC33557C3AD3EB23AC070059220E9549745D` |

## 요구조건과 시험 커버리지

| 요구조건 | 직접 실행한 시험 및 코드 확인 | 판단 |
| --- | --- | --- |
| 가까움→멀어짐→재접근 시 점진 감쇠와 출력 복구 | `test_moving_away_then_reapproaching_recovers_feedback`: -58→-82→-66, 하강 단조성 및 마지막 출력 증가. | PASS, 순수 PWM 제어기 재생 |
| 한 번 누락 유예, 장기 누락 종료 | `test_one_missing_scan_is_graceful_but_extended_loss_fades_to_zero`: 1100ms 양수 유지, 1400ms 감소, 4000ms 0. | PASS |
| STOP 즉시 초기화, START와 대상 변경 시 이전 필터 폐기 | `test_stop_and_start_clear_previous_filter_state` 및 mailbox 3개 명령 시험. 스케치는 다음 loop 소비 시 `writeMotorPwm(0)`을 호출한다. | PASS, 스케치의 20ms는 nominal 주기이며 실제 최대 응답시간 측정값이 아님 |
| uint32 시간 wrap·시간 역전 | `test_elapsed_time_handles_uint32_wrap`, `test_time_reversal_does_not_create_a_large_elapsed_interval`. | PASS |
| 1/5/20/100ms tick 독립성 | `test_ramp_progress_is_based_on_elapsed_time_not_loop_frequency`: 300ms 상승 후 출력 차이 ≤1. | PASS, 모든 손실 경계·스케줄 조합을 전수검증한 것은 아님 |
| 늦은 새 표본이 큰 출력 점프로 이어지지 않음 | `test_new_signal_after_long_gap_does_not_jump_to_full_output`. | PASS |
| 상태 유지 중 새 원시 RSSI Notify, 누락 중 과거 표본 금지 | `test_notify_gate_emits_fresh_rssi_at_a_bounded_cadence`: 999/1000ms 경계와 새 표본 없는 상태 변화 거절. 스케치 `update.found` 경로에서 `update.rssi`만 전달. | PASS, gate 단위 실행 및 스케치 정적 연결 확인 |
| 스캔 중 타깃 변경 시 이전 세대 결과 폐기 | `test_target_change_during_scan_rejects_old_result_and_keeps_scan_owned`: 이전 callback 완료까지 재시작 금지, 다음 스캔의 새 target/RSSI 확인. | PASS |
| 게시 후 STOP 및 빠른 STOP→START, 소비 전 결과 덮어쓰기 금지 | `test_stop_after_publication_drops_queued_rssi_and_restart_is_clean`, `test_rapid_stop_start_and_pending_result_cannot_be_overwritten`. 시작 실패 후 재시도도 확인. | PASS |
| consume와 scan begin 사이 명령이 도착하는 경합 | `test_command_between_consume_and_scan_start_requires_fresh_control`. | PASS |
| consume 후 Notify/PWM 이전 STOP/대상 변경 수락 경합 | `test_commands_cannot_be_accepted_between_consumption_and_output`: 실제 사용되는 `FeedbackTransactions`에 결정적 mutex 대역을 적용해 두 명령 모두 출력 중 수락이 거절되고, 출력 완료 후 수락 시 이전 표본이 다시 소비되지 않는지 확인. | PASS, P2 회귀 추가 |
| 명령 transaction 진행 중 출력 금지와 pending RSSI 폐기 | `test_command_transaction_excludes_output_and_discards_pending_sample`: 명령의 잠금 보유 중 출력 진입 거절, STOP 이후 notification 0 확인. | PASS, P2 회귀 추가 |
| 아직 소비하지 않은 regular/prepared 명령의 RX 보존 | `test_notification_does_not_overwrite_unconsumed_regular_or_prepared_command`: SDK가 완성해 둔 것으로 가정한 STOP/SET_TARGET 문자열이 TX 이후 동일한지 확인. | PASS, shared value 대역이며 실제 prepared fragment 처리 시험은 아님 |
| JSON 작성과 제출 사이 SDK Write가 끼어들 때 TX 보존 | `test_sdk_write_cannot_replace_json_between_notify_build_and_submit`: sendRaw 대역에 RX 쓰기를 주입해 송신 JSON과 RX 명령 양쪽 보존 확인. | PASS |
| CCCD 구독·해제·MTU·connId 재사용 | `test_notification_requires_per_connection_subscription_and_complete_mtu`: 연결별 구독 분리, 해제·disconnect 차단, 재연결 시 MTU23/미구독 초기화, MTU=payload+2 거절 및 +3 허용. | PASS, peer 상태 클래스 단위 시험 |
| MTU64 내 완전한 JSON | `test_all_notify_states_fit_one_mtu64_frame`: 상태 5개×RSSI 3개(-100/-55/INT32_MIN), 길이·닫는 괄호·oversize 거절. | PASS. local MTU185 호출 성공 자체의 동적 시험은 아님 |
| 완전 소실 이후 약한 재접근 | `test_weak_signal_recovers_after_full_loss`: 4000ms 출력 0 뒤 -82dBm 표본으로 양수이자 100 미만 출력 복구. | PASS, 실제 느린 보행·연속 거리 변화 재현은 별도 실물 항목 |
| GPIO25 PWM과 비차단 스캔 연결 | 스케치의 `analogWrite`, callback overload, `loop()`의 consume→tick→scan→20ms 순서 확인. | 정적 연결 확인; 실제 ESP32 빌드 결과는 아래에서 별도 기록 |
| BLE 재광고·기존 UUID/명령/JSON 보존 | diff에서 `onDisconnect`→`startAdvertising`, 기존 UUID 2개·명령 3개·state/rssi JSON과 상태 문자열 확인. | 정적 확인; 무선 재연결 미검증 |

## ESP32 빌드 증거

구현자는 Arduino CLI 1.5.1 / Arduino-ESP32 3.3.12 / FQBN `esp32:esp32:esp32`로 `.agent-loop/tools/sketch/ble_stick`을 빌드했다. 데이터·다운로드·사용자 라이브러리 경로는 `.agent-loop/tools`에 격리한다.

1. session `34721`: 최종 링크에서 Xtensa ld가 한국어 출력 경로의 `.elf`를 열지 못해 exit 1. 구현자의 오류 기록은 `ld.exe: cannot open output file .../ble_stick.ino.elf: No such file or directory`, `collect2.exe: error: ld returned 1 exit status`. Tester도 이 시점의 ELF 부재·0바이트 map을 직접 확인했다.
2. 정션 경로 시도: Arduino CLI의 `following symlink .../arduino-data/packages: The system cannot find the path specified` 오류, exit 1. 구현 보고를 확인했으며 Tester가 재실행하지 않았다.
3. session `99688`: 동일 작업 폴더를 가리키는 임시 `Q:` 드라이브 별칭으로 실행, **exit 0**. 이는 P2 수정 전 빌드이며 Flash 1,108,722 bytes, RAM 41,820 bytes였다.
4. session `1908`: 첫 output mutex P2 수정본 빌드, **exit 0**. Flash 1,109,146 bytes, RAM 41,828 bytes였으며 현재 최종 소스의 증거를 대신하지 않는다.
5. session `47473`: SDK shared value 분리와 local MTU185 설정을 포함한 canonical 소스를 같은 스테이징 폴더에 복사한 뒤 같은 명령으로 빌드, **exit 0**. 아래 출력이 현재 소스의 최종 결과다. 성공 명령과 원문 출력은 `.agent-loop/T1-esp32-build.log`에 보존되어 있다. 이는 구현자의 도구 출력 transcript이며 실행 중 직접 redirect한 로그가 아니다.

```powershell
$env:ARDUINO_DIRECTORIES_DATA='Q:\.agent-loop\tools\arduino-data'
$env:ARDUINO_DIRECTORIES_DOWNLOADS='Q:\.agent-loop\tools\arduino-downloads'
$env:ARDUINO_DIRECTORIES_USER='Q:\.agent-loop\tools\arduino-user'
Q:\.agent-loop\tools\arduino-cli\arduino-cli.exe compile --fqbn esp32:esp32:esp32 --build-path Q:\.agent-loop\tools\esp32-build Q:\.agent-loop\tools\sketch\ble_stick
```

```text
Sketch uses 1107858 bytes (84%) of program storage space. Maximum is 1310720 bytes.
Global variables use 41868 bytes (12%) of dynamic memory, leaving 285812 bytes for local variables. Maximum is 327680 bytes.
Process exit code: 0
```

성공 출력에 경고는 없다. Tester는 build.options의 FQBN 및 ESP32 3.3.12 경로, ELF 11,850,208 bytes, BIN 1,108,000 bytes와 2026-09-22 18:59 KST의 생성 시각을 확인했다. 원본 `.ino`/header와 스테이징 두 파일의 SHA256은 각각 위 표와 동일하다. 두 canonical/staged 파일의 최종 수정 시각은 각각 18:58:27/18:52:59로 빌드 artifact보다 앞선다. 생성된 `sketch/ble_stick.ino.cpp`에도 직접 Notify 경로·metadata handler·`setMTU(185)`가 들어 있다. sdkconfig의 `CONFIG_BT_ACL_CONNECTIONS=4`, `CONFIG_BLUEDROID_ENABLED=y` 및 설치된 ESP-IDF version header의 5.5.5를 직접 확인했다. 펌웨어를 기기에 올리거나 실행한 것은 아니다.

## P2 수정 연결부 정적 확인

- 일반 FreeRTOS mutex를 사용하는 `FeedbackTransactions`가 명령 수락과 `consumeScanUpdate()`→`updateMotorFeedback()` 전체를 감싼다. Notify는 소비 함수 내부라 같은 출력 경계에 포함된다.
- `onWrite`의 START/STOP/SET_TARGET은 동일한 `feedbackTransactions.run` 안에서 mailbox를 갱신한다. 출력 중에 명령이 도착하면 수락을 기다리고, 명령이 먼저 수락되면 다음 consume가 reset 및 표본 폐기를 적용한다. loop의 `tryRun` 실패 시 그 주기 출력은 실행되지 않는다.
- 잠금 순서는 일반 output mutex→짧은 stateMux이고 scan callback은 stateMux만 사용한다. 현재 최종 TX는 `esp_ble_gatts_send_indicate(..., false)`이며 characteristic `setValue/notify(true)`를 더 이상 사용하지 않는다. SDK TX 및 PWM 호출은 인터럽트 차단 critical section 밖에 있다.
- mutex 생성 실패 시 setup은 모터 0 상태에서 BLE 초기화 전에 멈춘다. README가 수신과 수락의 구분, 실제 모터 적용은 후속 제어 주기라는 한계를 설명한다.
- 새 두 시험은 같은 transaction 클래스를 사용하지만 알림/PWM 호출 자체는 counter로 대체한 결정적 단위 시험이다. 실제 FreeRTOS mutex 대기·BLE 스택 실행·무선 수신까지 검증한 것은 아니다.

## 최종 SDK 공유 버퍼 수정: 연결 근거와 시험 공백

- **RX 보존:** 스케치의 single-arg `onWrite`가 `getValue()`를 즉시 복사한 뒤 output mutex를 기다린다. 설치된 Arduino-ESP32 3.3.12 `BLECharacteristic.cpp`에서 regular WRITE는 619줄의 setValue 후 635줄의 onWrite, prepared EXEC_WRITE는 535줄 commit 후 538줄 onWrite, cancel은 540줄 cancel이며 916–917줄의 two-arg callback이 single-arg callback으로 전달한다. TX는 같은 characteristic 값을 더 이상 쓰지 않는다. 다만 호스트 시험은 이미 조립된 문자열을 RX에 놓는 대역으로서 실제 prepared 조각·offset·EXEC/CANCEL·SDK event union을 실행하지 않는다.
- **TX 독립 버퍼:** `NotificationFrame`의 로컬 JSON을 `sendIndependentNotification`→`DirectGattTransport::sendRaw`로 전달한다. `.agent-loop/tools/esp-idf-source-check/esp_gatts_api.c` 329–330줄의 `btc_transfer_context` deep-copy 인자와 `btc_gatts.c` 77–89줄의 별도 할당·memcpy를 직접 확인했다. 이 파일들은 구현자가 확보한 ESP-IDF 5.5.5 소스 참고 사본이며 host fixture가 실제 SDK heap/queue 실패·무선 완료를 검증한 것은 아니다.
- **CCCD/연결별 상태:** 스케치는 characteristic과 별개인 CCCD handle, interfaceId, connId, offset=0, len=2, 비-prepared WRITE를 확인한 뒤 구독을 갱신한다. connect/disconnect/MTU와 TX는 같은 output mutex를 사용한다. 설치된 BLEDevice.cpp는 server event 처리 후 custom handler를 호출하며 BLEServer.cpp가 연결·해제·MTU callback을 전달하는 것을 확인했다. 새 시험은 peer 상태 클래스의 허용/거절·다른 연결 구독 분리·connId 재사용을 실행한다. 스케치 event adapter의 잘못된 handle/interface/길이, 모든 슬롯 포화, prepared CCCD 쓰기는 host 동적 시험에 없다.
- **MTU185:** 광고 시작 전에 `BLEDevice::setMTU(185)`를 호출하고 실패하면 모터0 상태에서 광고를 시작하지 않는 소스·최종 컴파일 입력을 확인했다. host 시험은 MTU-3 경계 및 MTU64에 JSON이 맞는지 검증한다. 실제 setMTU 반환, MTU 협상, CCCD write/재구독과 앱 수신은 실물 실행이 필요하다.
- **판정 경계:** 위 공백은 하드웨어/SDK 통합 실행 미검증이며 이번 19개 단위 시험 PASS를 대체하거나 취소하지 않는다. Reviewer는 정적 연결 근거와 공백을 함께 검토해야 한다. 현재 자동 시험 또는 정적 확인에서 별도 실패를 재현하지 못했다.

## 미검증 및 남은 확인

- 최초 RED→GREEN 과정은 독립 Tester가 재실행하지 않았다. P2 두 회귀 시험의 RED→GREEN은 구현 보고에 기록되어 있으나 Tester가 RED를 직접 실행했다고 주장하지 않는다.
- 19개 시험은 순수 C++ 제어기·Notify gate·mailbox·output transaction·독립 Notify/peer의 결정적 이벤트 순서 재생이다. `.ino` 전체를 호스트에서 실행하거나 실제 FreeRTOS 동시 스케줄·BLE 라이브러리 무선 이벤트를 실행한 증거가 아니다. 이미 BLE 스택에 제출된 이전 Notify의 무선 전송 완료를 취소하는 기능도 아니다.
- 최초 6개 표본 전 `NONE` Notify 없음, 안정 근접에서 통상 8개 표본 이후 상태 판정이라는 기존 계약을 문서가 명시한다. 자동 탑승의 앱 경로는 T2 및 장치 시험 범위다.
- 펌웨어 지원 버전의 실제 컴파일과 타 코어 버전 호환성은 구분한다. 이번 검증은 Arduino-ESP32 3.3.12 / ESP-IDF 5.5.5 Bluedroid에 한정되며 NimBLE 및 2.x 전체 호환 검증을 뜻하지 않는다.
- 실제 모터 최소 duty, 회로 전원·접지·다이오드, 실물 거리 왕복·느린 재접근·한 번/장기 누락·STOP/대상 변경·재연결·앱 Notify 수신은 미검증이다.
- 커밋·푸시·배포·플래시는 하지 않았다.
