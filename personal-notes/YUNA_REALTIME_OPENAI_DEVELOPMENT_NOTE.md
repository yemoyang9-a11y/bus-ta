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
  - 선택적으로 `REALTIME_SHARED_SECRET` 헤더 검사를 지원한다.
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

- `pnpm -r typecheck` 통과
- `apps/server/src/services/realtime/create-realtime-session.service.test.ts` 통과

## Mock 테스트 방법

외부 교통 API 키 없이 유나 GPT-Realtime Function Dispatcher만 테스트할 때 사용한다.

1. 모바일 env에 mock 플래그를 켠다.

```env
EXPO_PUBLIC_API_BASE_URL=http://localhost:3000
EXPO_PUBLIC_REALTIME_USE_MOCK=true
```

2. 서버 `.env`에는 OpenAI 세션 발급용 키만 있어도 된다.

```env
OPENAI_API_KEY=sk-...
REALTIME_SHARED_SECRET=
```

3. 앱에서 `HaneumRealtimeSession.connectWebRTC()`를 호출하면 GPT Function 호출은 실제 교통 API 대신 mock 응답으로 처리된다.

테스트 대화 예시는 다음과 같다.

- "병점역후문 가고 싶어"
- "첫 번째 노선으로 갈게"
- "버스 언제 와?"
- "안내 종료해줘"

## Realtime 대사만 확인하는 방법

화면 UI 연결 전, 터미널에서 `gpt-realtime-mini`가 어떤 말투로 답하는지만 확인할 때 사용한다.

```bash
cd /Users/iyuna/Documents/한이음
npm run realtime:dialogue -- "너는 한이음 버스 안내 AI야. 사용자에게 처음 인사하고 목적지를 물어봐."
```

다른 예시는 다음처럼 바꿔서 실행한다.

```bash
npm run realtime:dialogue -- "병점역후문에 가고 싶어. 시각장애인 사용자에게 짧게 안내해줘."
```

## 다음 연결 작업

- 실제 화면에서 `HaneumRealtimeSession.connectWebRTC()` 호출
- 위치 권한을 받아 `search_routes` Function 인자에 현재 GPS 주입
- 서버 `.env`에 `OPENAI_API_KEY` 입력 후 `/api/realtime/session` 실제 호출 확인
- 실제 음성 대화 시나리오 테스트
