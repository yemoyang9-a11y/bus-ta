# T7 P2 하차벨 확정 결과 일치 — 2026-09-23

상태: **구현/검증 완료, 소스 편집 동결. 독립 Reviewer 재검토 요청.** 원본 checkout·운영·DB·commit/push/배포 변경 없음.

## 문제와 좁은 변경

T3 서버는 최초 저장 결과를 보존한다. 기존 AlightScreen은 물리 결과를 즉시 UI에 확정하고, POST 뒤 최신 GET을 받아도 로컬 TTS는 제출한 result를 읽었다. 최초 SUCCESS 저장 뒤 충돌 FAIL 제출 시 서버가 SUCCESS를 유지해도 화면/로컬 음성은 FAIL이었다. 반대 충돌도 동일했다.

수정 파일은 다음 2개다.

- `apps/mobile/src/screens/AlightScreen.js`: 물리 flow 결과의 즉시 setBellOutcome 제거. 기존 POST 성공→최신 GET→수명 검사→state 반영 순서 유지. 최신 GET의 bellStatus가 SUCCESS/FAIL이고 tripStatus가 TRIP_DONE/CANCELLED가 아닐 때에만 confirmedOutcome을 만들어 UI와 로컬 TTS에 함께 사용한다. Realtime에도 동일한 서버 확정 상태만 알린다. POST 응답의 과거 스냅샷 대신 기존 최신 GET을 권위로 사용한다.
- `apps/server/src/integration/mobile-alight-screen.test.ts`: 실제 화면/세션을 실행하는 기존 hook harness에 최초 결과 보존 POST와 최신 GET·실패/대기 제어를 추가. 기존 12개 수명 시험을 보존하고 9개 회귀를 추가했다.

저장/GET 실패나 PENDING 등 미확정 상태에서는 물리 결과를 성공/실패로 확정하지 않는다. 저장 오류 안내, 재시도 횟수, 물리 STOP 중복 방지, 홈 취소, 운행 교체/blur 세대 검사, TRIP_DONE 뒤 늦은 실제 결과의 서버 저장 보존은 기존대로다. API/DB/인증/펌웨어/문서는 변경하지 않았다(본 보고서만 작성).

## RED → GREEN

같은 focused 명령을 구현 전/후 실행했다:

```powershell
pnpm --filter @bus-ta/server exec tsx --test src/integration/mobile-alight-screen.test.ts
```

- RED: 총21개 중 기존12 PASS / 새9 FAIL, exit1. `.agent-loop/T7-P2-red.log`.
- GREEN: **21/21 PASS**, exit0. `.agent-loop/T7-P2-focused.log`.
- 새9개: 최초 SUCCESS/물리 FAIL, 최초 FAIL/물리 SUCCESS, POST 실패, GET 실패, GET TRIP_DONE, GET CANCELLED, GET PENDING, GET 대기/blur 후 늦은 응답, Realtime 연결 상태의 충돌 결과.
- 충돌 시험은 잘못된 결과가 잠시라도 UI setter에 전달되지 않았음을 확인하고 로컬 TTS의 정확한 문자열을 검사한다. 대기/실패 시험은 UI/TTS 확정이 없음을 검사한다.

## 추가 검증

worktree 루트:

| 명령 | 실제 결과 | 로그 |
|---|---|---|
| `pnpm --filter @bus-ta/mobile typecheck` | PASS exit0 | T7-P2-mobile-typecheck.log |
| `pnpm --filter @bus-ta/server typecheck` | 집중 시험 harness 포함 PASS exit0 | T7-P2-server-typecheck.log |
| `pnpm lint` | PASS exit0 | T7-P2-lint.log |
| `git diff --check -- apps/mobile/src/screens/AlightScreen.js apps/server/src/integration/mobile-alight-screen.test.ts` | PASS; CRLF 안내만 | tool output |

apps/mobile cwd:

```powershell
node node_modules/expo/bin/cli export --platform android --output-dir ../../.agent-loop/tools/expo-android-t7-p2 --max-workers 2
```

Android export **PASS exit0**, 1064 modules, 17 assets. `.agent-loop/T7-P2-android.log`. 실제 산출물 `.agent-loop/tools/expo-android-t7-p2/_expo/static/js/android/index-3b7a0fab6ba7ac2c1e55d0b6b2b4a7da.hbc` **3,044,809 bytes**, metadata.json 존재. 별도 작업 출력 폴더로 기존 T7 산출물 보존.

경고: react-native-webrtc가 event-target-shim의 비공개 ./index 경로를 사용하여 Metro가 file-based resolution으로 fallback했다. NO_COLOR/FORCE_COLOR 중복 환경 경고도 있었다. 이번 narrow patch에서 의존성 변경하지 않았다.

## 한계

검증은 Windows 로컬 Node24.15.0의 실제 화면 코드 VM 시험과 TypeScript/ESLint/Metro Android export다. RN 실기기 렌더링, 실제 BLE 재전송, 운영 서버의 최초 결과 충돌, 스피커 음성, Android 설치는 실행하지 않았다. 최종 전체 통합 suite와 독립 재검토는 Director/T7 소유다.
