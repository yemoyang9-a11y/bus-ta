# T1 독립 시험

작업 폴더: 이 파일의 상위 저장소. 앱·펌웨어 파일을 수정하지 않는다.

1. 구현 완료 통보 후 `node scripts/test-cane-feedback.mjs`를 실행해 종료코드와 테스트 수/범위를 기록한다. 현재 8개이며 세대/generation 시험이 추가될 수 있다.
2. Arduino CLI 1.5.1, ESP32 코어3.3.12를 사용해 정식 ESP32 Dev Module 컴파일을 실행한다. 프로젝트 밖 SDK/개인 설정을 수정하지 않는다.
3. 환경: `.agent-loop/tools/arduino-cli/arduino-cli.exe`; `ARDUINO_DIRECTORIES_DATA`=`<worktree>/.agent-loop/tools/arduino-data`, DOWNLOADS=`.../arduino-downloads`, USER=`.../arduino-user`. canonical ino와 header를 `.agent-loop/tools/sketch/ble_stick`에 복사해 `--fqbn esp32:esp32:esp32 --build-path <worktree>/.agent-loop/tools/esp32-build`로 컴파일한다.
4. 단순 문자열 존재 검사만으로 완료 판단하지 않는다. STOP/START/SET_TARGET 도중 이전 scan callback의 결과가 적용되지 않는 generation 시험, 한 번의 누락/장기 누락, uint32 wrap, 느린 재접근, 1/5/20/100ms tick 동등성, 새 표본 없는 Notify 금지를 확인한다.
5. C++ 빌드 성공은 실물 PWM·BLE·모터 회로 검증이 아니다. 코드상 지원과 실제 실행 증거를 구분한다.
6. `git diff --check` 및 파일 범위 확인. 실제 명령·종료코드·경고·막힌 점을 `.agent-loop/T1-test-report.md`에 기록한다. 재현할 결함이 있으면 FAIL로 구체화하고 코드 수정을 하지 않는다.

기본 sandbox는 Windows child-process spawn을 거절할 수 있다. 같은 테스트를 `require_escalated`로 실행할 수 있으며, 이는 기능 테스트 실패와 구분한다. Arduino 한글 경로 실패 시 도구 전체를 바꾸지 말고 오류를 보고한다. firmware flash 금지.
