# T7 P2 독립 재시험 — 2026-09-23

**PASS — 하차벨 서버 확정 결과와 UI/음성 일치의 로컬 검증.** 구현 보고와 최종 AlightScreen/시험을 대조했다. 제품 코드 수정 없음.

WT: `C:\Users\yemoy\OneDrive\문서\한이음\.worktrees\rehearsal-20260922`, Windows/Node24.15.0/pnpm11.7.0.

## 직접 실행

모든 명령은 worktree root에서 승인된 로컬 실행으로 수행했다. 시험 출력은 `$LASTEXITCODE`를 보존해 성공 시 요약만 표시했다.

| 명령/검사 | 결과 | 직접 출력 chunk |
| --- | --- | --- |
| `pnpm --filter @bus-ta/server exec tsx --test src/integration/mobile-alight-screen.test.ts` | **21/21 PASS**, fail/skip 0, exit 0 | `705204` |
| 실제 화면 harness를 메모리에서 재사용한 추가 3경계 | **3/3 PASS**, fail/skip 0, exit 0 | `396f56` |
| `pnpm --filter @bus-ta/mobile typecheck` | exit 0 | `1266e3` |
| `pnpm --filter @bus-ta/server typecheck` | exit 0 | `751daf` |
| `pnpm typecheck` | shared/server/mobile **및 scripts** 모두 exit 0 | `2a1f9d` |
| `pnpm lint` | exit 0 | `c08889` |
| 두 변경 파일 `git -c core.safecrlf=false diff --check` | exit 0 | `c48615` |

## 결과 대조

- **최초 서버 SUCCESS → 늦은 물리 FAIL → POST/GET SUCCESS:** 화면 setter에 fail이 한 번도 전달되지 않고 success만 확정했다. 로컬 TTS는 정확히 성공 문구를 사용한다. 연결된 Realtime에도 SUCCESS를 전달하며 로컬 TTS는 호출하지 않는다.
- **최초 서버 FAIL → 늦은 물리 SUCCESS:** 화면과 로컬 TTS가 FAIL만 사용한다. 독립 추가 시험으로 Realtime도 FAIL을 정확히 1회 받고 UI에 success가 전달되지 않는지 확인했다.
- **저장 실패/GET 실패/PENDING:** 물리 SUCCESS만으로 화면·음성을 확정하지 않는다. POST 네트워크 재시도는 기존 최대 3회이며 물리 STOP 요청은 1회다.
- **GET의 TRIP_DONE/CANCELLED:** 결과 확정 UI와 로컬 음성이 나오지 않는다. 독립 추가 2개 시험은 Realtime 연결 상태에서도 notify 0, speech 0, success/fail setter 0을 확인했다.
- **지연·중복 회귀:** GET pending 동안 waiting 유지, blur 뒤 늦은 GET 무시, 다음 운행에 이전 Notify/write 미반영, 기존 focus 중복 STOP 방지, 홈 종료 성공 경계, 완료 뒤 새 연결/STOP 차단, 이미 시작한 write의 진짜 Notify/POST 보존 등 기존 12개가 모두 통과했다.

소스는 물리 flow의 즉시 `setBellOutcome(outcome)`을 제거하고 **POST 성공 → 최신 GET → 운행/세대/terminal 검사 → confirmedOutcome** 순서로 UI와 로컬 TTS를 함께 정한다. Realtime은 같은 최신 GET의 bellStatus를 받는다. POST 응답의 과거 스냅샷이나 제출한 물리 result를 안내 근거로 쓰지 않는다.

추가 3개는 원본 시험 파일의 첫 test 등록 전 `setup`/`flush` harness만 메모리로 읽고, 위 세 단언을 붙여 TypeScript CommonJS 변환 및 VM 실행했다. 실제 Alight 소스를 매번 읽고 실제 bell-stop-session/sender를 사용한다. `node apps/server/node_modules/tsx/dist/cli.mjs --eval`로 실행했으며 임시 파일/시험 소스를 만들거나 변경하지 않았다.

## 소스 식별 및 Android 증거 범위

검증한 SHA256 (`7b94dd`):

- `apps/mobile/src/screens/AlightScreen.js`: `11427216479A40E2BB1403716486C3448B74D908482349325DECD61DD2ECFCA3`
- `apps/server/src/integration/mobile-alight-screen.test.ts`: `76660962A832AA49705843DEDCDF0B0E4E7192FA58EAEEE0375C3130B83DA766`

구현자의 `T7-P2-android.log`에서 1064 modules/17 assets와 export 완료를 읽고 `.agent-loop/tools/expo-android-t7-p2/_expo/static/js/android/index-3b7a0fab6ba7ac2c1e55d0b6b2b4a7da.hbc` **3,044,809 bytes**, metadata.json 존재를 확인했다. 화면 수정 시각 20:10:21, 산출물/로그 20:11:41 순서도 맞는다. 다만 빌드 입력 hash manifest가 없어 현재 source와 HBC의 암호학적 일치까지 입증하지는 않았고, Tester가 export를 재실행한 결과도 아니다. 기존 event-target-shim fallback 경고가 로그에 남는다.

## 한계와 인계

UI는 실제 화면 코드의 hook VM 시험이며 RN 렌더러/BLE/POST/GET/음성 출력은 대체한다. 최초 결과 보존 DB도 harness에서 재현하므로 운영 DB 충돌이나 실물 음성 검증으로 표현하지 않는다. Director의 전체 서버 471개 실행은 별도 증거이며 이번 직접 시험 집계에 합산하지 않는다. Android 설치·실물 BLE/스피커·외부 API는 미검증이다.

작성 파일은 **`.agent-loop/T7-P2-testing.md` 하나**다. 코드/시험 원본/DB/커밋/푸시/배포 변경 없음. **재현된 실패 없이 Reviewer 재검토로 인계 가능.**
