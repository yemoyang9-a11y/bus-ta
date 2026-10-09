# T6 제한 문서 감사 — 2026-09-22

판정: **중요 모순/누락에 대한 수정 요청 없음.** 아래 선택적 보완 1개를 제외하고, 읽은 현재 문서 범위에서 깨진 새 상대 링크·잘못된 완료 확정·최신 실물 성공 과장·원본 보존 방침 누락을 찾지 못했다. T4/T5와 다른 진행 중 단계의 상태는 결함으로 분류하지 않았다.

## 범위와 방법

- 작업 폴더: `.worktrees/rehearsal-20260922`.
- 읽은 문서 10개: `docs/superpowers/plans/2026-09-22-rehearsal-results.md`, root `README.md`, `docs/PROJECT_OVERVIEW.md`, `DEMO_SCENARIO.md`, `DEVELOPMENT_RULES.md`, `ARRIVAL_POLLING.md`, `personal-notes/PENDING_DECISIONS.md`, `REMAINING_CHECKLIST.md`, `docs/demo-scenario/demo-data.md`, `expected-results.md`.
- 변경 diff와 현재 문서를 대조했다. fixture 표의 사실 확인에는 shared의 demo-route/demo-locations/demo-beacon 원본만 추가로 읽었다. 앱/서버/펌웨어 코드나 다른 문서를 변경하지 않았다.
- Node 읽기 전용 검사 결과: 결과표 ID 행43개/고유43개, 예상 R01–R03/A01–A10/V01–V09/D01–D09/M01–M12 누락0/추가0. 10개 문서의 로컬 Markdown 링크41개, 파일/명시된 heading anchor 누락0. 명령 exit0, 출력 chunk `2d93fa`.

## 확인 결과

- 결과표의 T1 19 PASS·Flash1,107,858/RAM41,868은 최종 펌웨어 빌드 기록과 일치한다. 실제 prepared Write/MTU 협상·모터/무선/RTOS는 여전히 실물 미검증으로 표시되어 있다.
- T3는 로컬 migration/RPC/SQL 검증과 운영 미적용을 구분한다. 전체 서버 중간 snapshot을 통합 완료 근거로 쓰지 않는다.
- DEMO_SCENARIO의 최신 시험표13행은 모두 미실행이며, 사용자 과거 수동 탑승/물리 벨 관측을 최신 자동 탑승·완주 성공으로 확장하지 않는다. GPS 목적지 도착과 실제 하차 감지도 구분한다.
- ARRIVAL_POLLING의 공개 GET 응답은 UPSTREAM_ERROR와 기존 배열이 함께 있을 수 있다는 정정이 현재 결과표와 개인 결정표에 맞는다. 내부 null 스냅샷과 공개 배열 변환의 설명도 구분되어 있다. 오류 때 이전 숫자를 최신 정보로 안내하지 않는 정책과 모순되는 현재 확정 문구는 발견하지 못했다.
- demo-data의 candidateId7/1551/localBusId234001138/gbisStationId233001214, sequence0–10, 두 비콘 ID와 non-mock 표시는 현재 shared fixture에 맞는다. 운영 DB 값의 증거로 사용하지 않는다고 명시한다. expected-results는 GPS만으로 탑승을 확정하지 않고 탑승확정 후2/1/0정류장으로 이어진다.
- 결과표·PROJECT_OVERVIEW·개인 남은 목록에 원본 사용자 변경/ebb5bdd/옛 worktree 보존 방침이 있다. 이번 감사는 실제 원본 파일 무변경이나 Git 상태의 전체 대조를 다시 수행한 것은 아니다.
- 역사적 체크박스·7/1 시연 내용에는 명확한 과거 표시와 최신 계획/결과 우선 안내가 있다. 과거 미완료 항목을 현재 오류로 재등록하거나 전체 재작성하도록 요구하지 않았다.

## 선택적 보완 (승인 차단 아님)

- `docs/DEMO_SCENARIO.md:17`의 최신 시험3번에, 새 T1/T2 경계의 **실제 협상 MTU값(64 이상), CCCD 재구독, 긴 SET_TARGET의 prepared Write 처리 결과**를 기록 항목으로 명시하면 최종 T1 결과의 실물 미확인 항목을 중앙 현장 표에서 바로 실행할 수 있다. 현재 결과 문서54행에 이 한계가 이미 명시되어 있어 성공 과장이나 계약 모순은 아니다.

이 보고서만 생성했다. 감사 시점 이후 병렬 작업의 문서 변경과 최종 통합 시험은 Director/T7 검증 범위다.
