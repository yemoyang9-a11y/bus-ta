# 프로젝트 개요 및 전체 흐름

> 문서 상태: 최종 개발 기준. 세부 API와 데이터 계약은 [API_SPEC.md](API_SPEC.md), [DB_SCHEMA.md](DB_SCHEMA.md)를 따른다.

## 목적

시각장애인이 음성 대화로 목적지를 입력하고, 버스 탐색·탑승·이동·하차를 안내받도록 모바일 앱, 백엔드, GPT-Realtime mini, BLE 하드웨어를 연결한다. AI는 사용자의 의도를 이해하고 안내하지만, 경로·운행 상태·하차 시점의 사실 판단은 백엔드가 담당한다.

## 최종 사용자 흐름

```text
앱 실행 → 권한 확인 → Realtime 음성 세션 연결 → 목적지 대화 입력
→ 경로 후보 안내 → 사용자 선택 → 운행 생성 → 버스 접근 안내
→ GPS 상태 업데이트 → 하차 준비 안내·하차벨 요청 → 도착 또는 운행 취소
```

## 구성 요소와 책임

- **프론트엔드**: 접근성 UI, 마이크·위치·BLE 권한, Realtime WebRTC 연결, Function/Event Dispatcher, GPS·BLE 결과 전송.
- **GPT-Realtime mini (`gpt-realtime-mini`)**: 음성 대화, 의도 파악, 정의된 Function 선택, 백엔드 결과의 음성 안내. 운행 정보를 임의 생성하거나 상태를 확정하지 않는다.
- **백엔드**: Realtime 단기 키 발급, 경로·도착 정보 조회, 운행·상태·하차벨 관리, DB 저장, 외부 API 오류 처리.
- **하드웨어**: 버스 비콘 송출, 스마트지팡이의 대상 비콘 감지·진동, 하차벨 BLE 명령 처리. 감지 결과를 서버에 저장하는 공개 API는 아직 확정되지 않았다.

## 시스템 흐름

1. 앱은 `POST /api/realtime/session`으로 단기 키를 받고 WebRTC 세션을 연다. OpenAI API 키는 백엔드에만 둔다.
2. 모델의 Function 호출을 앱 내부 Dispatcher가 받아 REST API를 호출하고, 결과를 Realtime 세션에 반환한다.
3. `search_routes` → `POST /api/routes/search`, `create_trip` → `POST /api/trips`, `get_trip_status` → `GET /api/trips/{tripId}`, `end_trip` → `PATCH /api/trips/{tripId}`로 연결한다.
4. 탑승 후 앱은 약 3초 간격으로 `PATCH /api/trips/{tripId}/status`를 호출한다. 백엔드가 상태와 하차벨 생성 여부를 결정한다.
5. `remainingStations = 1`에서 새 하차벨 요청이 생성되면 앱은 `STOP_REQUEST`를 BLE 또는 mock 장치에 전달하고, 결과를 `POST /api/trips/{tripId}/bell/result`로 기록한다.

## 구현 상태 표기

- 문서의 계약과 현재 구현 사실은 구분한다. 현재 사실은 `claude/nice-archimedes-iv7iu0` 코드, `packages/shared`, 테스트 및 실제 Supabase 적용 상태로 확인한다.
- `POST /api/realtime/session`은 계약이 확정됐지만 구현 여부는 별도 확인 대상이다.
- 중간평가·mock 중심 문서는 역사적 범위 설명이며, 현재 계약 판단에는 이 문서와 아래의 최종 명세를 사용한다.

## 문서 체계

- [API 및 Function Calling 명세](API_SPEC.md)
- [공통 데이터 모델 및 상태 명세](DB_SCHEMA.md)
- [모듈 계약과 책임 경계](MODULE_CONTRACTS.md)
- [프론트엔드 개발 지침](FRONTEND_GUIDE.md)
- [GPT-Realtime mini 개발 가이드](REALTIME_GUIDE.md)
- [개발 규칙 및 협업 컨벤션](DEVELOPMENT_RULES.md)
