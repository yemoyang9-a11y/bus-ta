# 유나 GPT-Realtime mini 개발 작업 기록

## 기준

- 기준 브랜치: `claude/nice-archimedes-iv7iu0`
- 개인 브랜치: `yuna-realtime-openai`
- 기준 문서:
  - `docs/REALTIME_GUIDE.md`
  - `docs/API_SPEC.md`
  - `docs/DATA_MODEL.md`
  - `docs/FRONTEND_GUIDE.md`
  - `docs/DEVELOPMENT_RULES.md`
  - `docs/SYSTEM_FLOW_AND_ROLES.md`

## 반영한 다른 브랜치 맥락

- `hyorin-develop`: 경로 검색, ODsay/Kakao/GBIS 연동 흐름은 기준 브랜치에 포함되어 있어 그대로 사용한다.
- `yemo-develop`: 기준 브랜치보다 뒤처진 상태라 직접 병합하지 않고, 백엔드 API 계약은 기준 문서를 따른다.
- `chaerin-develop`: WebRTC/BLE 앱 설정과 의존성 방향을 반영한다.

## 구현 내용

- 백엔드 `POST /api/realtime/session` 추가
  - 서버의 `OPENAI_API_KEY`로 OpenAI Realtime 단기 키를 발급한다.
  - 앱에는 장기 OpenAI API 키를 전달하지 않는다.
  - `REALTIME_SHARED_SECRET`과 요청 헤더 `x-realtime-shared-secret`이 일치할 때만 단기 키를 발급한다.
  - 서버에 `REALTIME_SHARED_SECRET`이 없으면 인증 없이 열지 않고 `SERVER_CONFIG_ERROR`로 거부한다.
- shared 계약 추가
  - Realtime 세션 응답 타입
  - 운행 생성/종료 응답 타입
  - Realtime API path
- 모바일 Realtime 핵심 코드 추가
  - GPT 시스템 지침
  - Function schema
  - Function Dispatcher
  - 대화 상태 context
  - WebRTC transport adapter
  - `HaneumRealtimeSession.connectWebRTC()` 헬퍼
  - Expo config `extra.realtimeSharedSecret` 기반 공유 비밀 전달 경로

## Function 연결 원칙

- 공개 Function은 문서 기준 4개만 사용한다.
  - `search_routes`
  - `create_trip`
  - `get_trip_status`
  - `end_trip`
- 별도 도착정보 Function은 만들지 않는다.
- 도착 예정 시간은 `POST /api/trips` 생성 응답의 `predictedArrivalMinutes`만 사용한다.
- `create_trip`은 모델이 만든 임의 route 객체를 믿지 않고, `search_routes` 응답으로 저장된 후보를 `candidateId`로 찾아 백엔드에 전달한다.

## 검증 결과

- `pnpm --filter @bus-ta/shared typecheck` 통과
- `pnpm --filter @bus-ta/server typecheck` 통과
- `pnpm --filter @bus-ta/mobile typecheck` 통과
- `pnpm --filter @bus-ta/server exec tsx --test src/routes/realtime.test.ts` 통과
  - `REALTIME_SHARED_SECRET` 없음: `500 SERVER_CONFIG_ERROR`
  - 공유 비밀 불일치: `401 UNAUTHORIZED`
  - 공유 비밀 일치: `200`, `clientSecret` 반환
- `REALTIME_SHARED_SECRET=check-secret pnpm --filter @bus-ta/mobile exec expo config --type prebuild` 통과
  - `app.config.ts` 동적 설정 인식
  - `extra.realtimeSharedSecret` 주입 확인
  - `@config-plugins/react-native-webrtc` plugin 적용 확인
- 임시 모노레포(`/private/tmp`)에서 `CI=true REALTIME_SHARED_SECRET=check-secret pnpm --filter @bus-ta/mobile exec expo prebuild --no-install --platform android` 통과
  - native `android` 디렉터리 생성과 prebuild 완료 확인
  - 실제 workspace에는 native 생성물을 반영하지 않음

## 아직 실행하지 않은 검증

- 실제 WebRTC 음성 세션 연결은 Expo Dev Client 또는 native build가 설치된 기기, 서버 `.env`의 `OPENAI_API_KEY`, `REALTIME_SHARED_SECRET`, 모바일 빌드 환경의 동일 `REALTIME_SHARED_SECRET`이 필요해 아직 수동 통합 테스트가 필요하다.

## 다음 연결 작업

- 실제 화면에서 `HaneumRealtimeSession.connectWebRTC()` 호출
- 위치 권한을 받아 `search_routes` Function 인자에 현재 GPS 주입
- 실제 음성 대화 시나리오 테스트
