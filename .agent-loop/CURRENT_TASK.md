# 리허설 후속 작업 현재 배정

2026-09-23 후속 요청: 사용자가 완료된 로컬 작업의 커밋과 PR 생성을 명시적으로 요청했다. 아래의 초기 구현 단계 금지 항목 중 커밋·feature 브랜치 푸시는 이 후속 요청으로 승인됐으며, 원본 폴더 수정·병합·배포·운영 DB 변경은 승인되지 않았다.

- T1 상태: COMPLETE_LOCAL — 최종 호스트 19 PASS, ESP32 빌드·소스 일치 확인, Reviewer spec/quality APPROVE
- T1 재시도: 2 — BLE SDK Write와 Notify의 공유 characteristic 값 경합 수정
- T2 상태: COMPLETE_LOCAL — P2 늦은 연결/종료 경합 보완, 독립 재시험 48/48·모바일 타입 검사 PASS, Reviewer 명세·품질 APPROVE. 실물은 미검증.
- T3 상태: COMPLETE_LOCAL — 독립 시험 PASS, Reviewer spec/quality APPROVE, Director 확인. 운영 미적용.
- T4 상태: COMPLETE_LOCAL — 독립 관련 시험 181/181·shared/server/mobile 타입 검사 PASS, Reviewer 명세·품질 APPROVE. Notion 구버전과 차이는 최신 사용자 확정 규칙 우선으로 기록.
- T5 상태: COMPLETE_LOCAL — scripts TS 검사 누락 P2 보완 후 독립 시험·Reviewer 명세/품질 APPROVE. lint/typecheck/build·scripts 68/68·C++19·로컬 SQL 경합 PASS. 실제 Linux CI는 미실행.
- T6 상태: COMPLETE_LOCAL — 43개 조사 ID와 문서/현장 시험표 정리, Notion 7개 읽기 및 사용자 최신 기준 충돌 공개. Notion 자체는 변경하지 않음.
- T7 상태: COMPLETE_LOCAL — 최종 서버 471/471, 보안 7/7, Android 번들, 독립 P2 재시험·최종 Reviewer 명세/품질 APPROVE. 실제 기기·외부 API·운영 DB는 미검증. 작업용 PostgreSQL 55439/55440 모두 정상 종료.
- 계획: `docs/superpowers/plans/2026-09-22-rehearsal-backlog.md` T1 및 공통 제약
- 허용 파일: `hardware/smart-cane/ble_stick.ino`, `hardware/smart-cane/proximity-feedback.h`, `hardware/smart-cane/tests/proximity-feedback.test.cpp`, `hardware/smart-cane/README.md`, `scripts/test-cane-feedback.mjs`
- 금지: 원본 작업 폴더, 앱/서버/DB, 기존 nested ble_stick 사본, commit/push/배포/실물 flash.
- 완료: 점진적 감쇠/약한 재접근 복구/일시 누락 유예/장기 누락 종료/즉시 STOP/START 초기화/대상 변경 초기화/시간 overflow/재광고. UUID와 기존 Notify 형식 유지.
- 검증: 순수 C++ 모터 제어기 재생 테스트 RED→GREEN. 가능하면 ESP32 실제 컴파일. 실물 결과로 주장하지 않는다.
- 절차: 작업별 Implementer → Tester → Reviewer. Director는 코드 대신 계획·환경·결과 기록 담당. T1/T2/T3 파일 소유권은 분리하며 세부 범위는 T1-testing-brief.md, T2-brief.md, T3-brief.md를 따른다. T4 서버/shared는 T3 완료 뒤 진행하고 모바일은 T2 편집 종료 뒤 진행한다. T5는 T4 뒤 진행.
