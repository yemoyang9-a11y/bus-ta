# 미결정 사항 (판단·팀 상의 필요)

> **개인 참고용 문서입니다.** 팀 공통 API 명세나 개발 기준으로 사용하지 않습니다.
> 팀 공통 기준은 `README.md`, `AGENTS.md`, `docs/API_SPEC.md`, `docs/DB_SCHEMA.md`, `docs/DEVELOPMENT_RULES.md`를 우선합니다.
>
> 여기 있는 항목은 실행만 하면 되는 작업이 아니라 **결정이 먼저 필요한 것들**이다.
> 결정이 끝나면 항목을 지우고, 실행할 작업은 `personal-notes/REMAINING_CHECKLIST.md`로 옮긴다.
> 결정된 내용이 API/DB 계약에 영향을 주면 `docs/API_SPEC.md`·`docs/DB_SCHEMA.md`도 함께 갱신한다.

---

## 1. bell/result 재시도 정책

- 현황: `docs/API_SPEC.md`에 "실패 후 자동 재시도 정책은 중간평가 구현 전 확인 필요"로 남아 있음.
- 왜 중요한가: 확장 로깅 API(`POST /api/ble/detections`, `POST /api/vibration/logs`) 초안의
  멱등 키·append-only 여부 설계가 이 결정에 그대로 의존한다.
- 검토한 옵션: 재시도를 "네트워크 실패 복구용 멱등 재전송"으로만 한정하고, 모든 쓰기 API에
  "클라이언트 멱등 키 + DB unique + 중복 시 기존 결과 재반환" 규약을 통일 적용하는 안을 권장으로 검토함
  (2026-07-16 대화 참고). 하차벨을 FAIL 후 재시도할지는 별개 문제로 채린(앱 UX)과 상의 필요.
- 결정 주체: 채린·정민과 상의 후 예모가 확정.

## 2. system_logs 테이블 포함 여부

- 현황: `docs/ARCHITECTURE.md`에만 "선택" 테이블로 언급. 마이그레이션·`docs/DB_SCHEMA.md`·코드
  어디에도 없음.
- 왜 중요한가: 최종 시연에 서버·외부 API 오류 기록이 필요한지에 따라 이번 스코프 포함 여부가 갈림.
- 결정 주체: 예모(백엔드 필요성 판단) → 팀 공유.

## 3. 다중 비콘 선택 규칙

- 현황: `SupabaseBeaconRepository.findByRouteNo`는 한 노선에 여러 차량 비콘이 있을 때
  `status=ACTIVE` 중 `created_at` 최신 1건을 반환하는 것으로 구현되어 있음(추측 기반 설계).
- 왜 중요한가: 실제 운영에서 "같은 노선의 여러 버스 중 사용자가 탄 차량"을 구분해야 한다면
  `routeNo`만으로는 부족하고 `localBusId` 또는 `vehicleId` 기반 매칭이 필요할 수 있음.
  (`docs/API_SPEC.md` "구현 전 확인 필요" 목록에도 동일 항목 있음: "targetBeaconId를 routeNo만으로
  조회할지, 최종적으로 localBusId 또는 vehicleId 기반으로 바꿀지 확인 필요")
- 결정 주체: 정민(실제 비콘 배치 방식) + 예모.

## 4. Supabase 미설정 시 처리 정책 — 일반 규칙으로 문서화할지

- 현황: 지금 코드에 두 가지 패턴이 공존한다.
  - `trips.ts`(`POST /trips`, `PATCH /status`, `POST /bell/result`): Supabase 미설정 시 무조건 500 하드 실패
  - `beacons.ts`(`GET /beacons`): Supabase 미설정 시 fixture로 자동 대체
  - 이 차이는 의도적 설계(읽기 전용 참조 데이터는 fixture 허용, 상태를 쓰는 API는 하드 실패)이지만
    코드 주석에만 있고 `docs/DEVELOPMENT_RULES.md`나 `docs/MODULE_CONTRACTS.md`에 일반 규칙으로
    적혀 있지 않다.
- 왜 중요한가: 다음에 만들 `ble_logs`/`vibration_logs` 레포지토리가 두 패턴 중 어느 쪽을 따라야
  할지 지금은 근거 문서가 없어 코드를 베낄 사람 마음대로 고르게 된다.
- 검토한 방향: "GET(읽기 전용 참조 데이터)은 fallback 허용, POST/PATCH(상태 변경)는 하드 실패"를
  일반 규칙으로 `docs/DEVELOPMENT_RULES.md`에 명문화하는 안. (2026-07-16 code-review altitude 지적)
- 결정 주체: 예모 단독 결정 가능(팀 영향 적음). 문서화만 하면 됨.

## 5. status=ACTIVE 필터의 fixture/DB 동작 불일치

- 현황: `SupabaseBeaconRepository.findByRouteNo`는 `status=ACTIVE`인 행만 반환하지만,
  `FixtureBeaconRepository`(및 `Beacon` 타입 자체)에는 `status` 개념이 아예 없어 항상 매칭된다.
- 왜 중요한가: 지금은 시드된 행이 1개뿐이라 드러나지 않지만, `bus_beacons`에 `INACTIVE` 행이
  쌓이기 시작하면 Supabase 설정 여부에 따라 같은 요청의 결과가 달라진다(DB는 404, fixture는 매칭).
- 검토할 옵션: (a) fixture는 순수 데모용이라 status 불일치를 허용하고 문서에만 명시, (b) `Beacon`
  타입에 `status`를 추가해 fixture도 동일 규칙을 따르게 함.
- 결정 주체: 예모 단독 결정 가능. (2026-07-16 code-review 발견)

---

## 처리 이력

- 2026-07-16: 5개 항목 최초 정리 (bus_beacons Supabase 연동 code-review 결과 + 기존 계획 파일에서 이관)
