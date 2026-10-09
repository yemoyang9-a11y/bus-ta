# 최종 검증 실행표

계획 T7. T2 P2 재검토, T4·T5의 구현→독립 시험→검토가 끝난 뒤 최종 변경 기준으로 실행한다. 각 명령은 종료코드와 시험 개수를 기록한다. 성공하지 않은 명령은 이유·재현·수정 및 다시 실행한 결과를 남긴다. 기존 중간 단계의 결과를 최종 결과처럼 쓰지 않는다.

- `pnpm -r typecheck`: shared/server/mobile.
- `pnpm build`: shared/server 실제 출력 경로, 서버 `main`이 그 위치와 일치하는지 확인.
- `pnpm lint`: 추가된 의미 있는 규칙 실제 실행.
- `pnpm --filter @bus-ta/server test`: 전체 서버/모바일 통합 시험.
- `scripts/*.test.mjs`와 `scripts/*.test.ts`: CI와 같은 명령으로 별도 전체 실행.
- `node scripts/test-cane-feedback.mjs`: 최종 C++ 호스트 재생. T1 뒤 펌웨어가 바뀌지 않았으면 이미 확인한 동일 소스 ESP32 build session47473/hash를 재사용하며 중복 정식 컴파일은 하지 않는다.
- 독립 작업용 `127.0.0.1:55439` PostgreSQL 15.19가 실행 중이면 T3 `node scripts/test-bell-result-sql.mjs`와 기존 boarding SQL을 다시 실행한다. 기동 시 `.agent-loop/pg-env.json`의 bin/data 경로와 포트가 이번 작업용인지 먼저 확인한다. 운영 DB·Docker 기존 데이터는 건드리지 않는다.
- `apps/mobile`에서 `node node_modules/expo/bin/cli export --platform android --output-dir ../../.agent-loop/tools/expo-android --max-workers 2`: 로컬 Android 번들/JSX 연결. 출력은 Git에서 제외된 작업용 도구 폴더에 둔다. 성공해도 설치·실기기 음성/BLE 증거가 아니다.
- Supabase security 시험/감사, `git diff --check`, 원본 체크아웃 변경 보존, 추가 파일의 민감값 여부, tracked/untracked 수정 범위를 확인한다.
- 별도 최종 Reviewer가 단계 간 경계와 새 파일까지 검토하고, 중요한 결함은 담당자가 재현→수정→관련검증 반복. 마지막에 결과 문서의 43개 ID 및 현장·외부·계약 대기 항목을 갱신한다.

진행 중 단계의 시험과 충돌하지 않도록 T7 전체 명령은 T5 변경이 멈춘 뒤 한 번 실행한다.
