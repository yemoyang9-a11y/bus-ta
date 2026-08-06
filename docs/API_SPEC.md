# 공통 API 및 Function Calling 명세

> **문서 상태: 구버전 — 작업 기준으로 참고하지 않는다.** 이 문서는 7/1 중간평가 기준으로 작성됐고 이후 갱신되지 않았다. 개발 문서의 단일 출처는 노션이다 — API·Function Calling 계약은 노션 「공통 API 및 Function Calling 명세서」를, 데이터 모델·상태 전이는 노션 「공통 데이터 모델 및 상태 명세서」를 기준으로 작업한다. 코드 작업·리뷰·문서 대조는 반드시 노션 문서를 기준으로 하고, 이 파일의 내용을 판단 근거로 삼지 않는다.

## 공통 규칙

- 공개 JSON과 Function 인수는 `camelCase`, DB 컬럼은 `snake_case`를 사용한다.
- 성공·실패 응답에는 `success`, `message`, `timestamp`를 사용하며 실패에는 `errorCode`를 포함한다.
- 모델은 `tripId`, `requestId`, `bellRequestId`, 현재 좌표, 서버가 계산하는 상태값을 임의 생성하지 않는다.
- Function 결과와 REST API 오류는 Dispatcher가 원문 구조를 보존해 Realtime 세션에 돌려준다.

## Realtime Function

| Function | REST API | 책임 |
| --- | --- | --- |
| `search_routes` | `POST /api/routes/search` | 목적지와 위치로 후보 경로 조회 |
| `create_trip` | `POST /api/trips` | 사용자가 선택한 후보로 운행 생성 |
| `get_trip_status` | `GET /api/trips/{tripId}/status` | 저장된 운행 상태 조회 |
| `end_trip` | `PATCH /api/trips/{tripId}` | 명시적 사용자 취소·종료 처리 |

Function은 사용자 의도를 처리하는 경로다. 자동 GPS·하차벨 처리는 아래 REST API를 앱이 직접 호출하고, 변화가 있을 때 Event Dispatcher가 세션에 알린다.

## REST API

| Method | Path | 상태 변경 |
| --- | --- | --- |
| `POST` | `/api/routes/search` | 없음 |
| `POST` | `/api/trips` | 운행과 초기 상태 생성 |
| `GET` | `/api/trips/{tripId}/status` | 없음 |
| `PATCH` | `/api/trips/{tripId}` | 사용자 취소 또는 종료 |
| `PATCH` | `/api/trips/{tripId}/status` | 위치 반영, 운행 상태·하차벨 판단 |
| `POST` | `/api/trips/{tripId}/bell/result` | 하차벨 결과 기록 |
| `GET` | `/api/beacons?routeNo=` | 없음 |
| `GET` | `/api/health` | 없음 |
| `POST` | `/api/realtime/session` | Realtime용 단기 키 발급 |

## Realtime 세션

`POST /api/realtime/session`은 백엔드가 OpenAI `POST /v1/realtime/client_secrets`를 호출해 단기 키를 반환하는 계약이다. 요청에는 `session.model`과 `expires_after`만 전달하고, `instructions`와 `tools`는 WebRTC 연결 후 앱이 설정한다. 장기 OpenAI API 키는 앱 번들에 포함하지 않고, 공유 비밀은 `EXPO_PUBLIC_`로 노출하지 않는다.

### `POST /api/realtime/session`

앱이 OpenAI Realtime WebRTC 연결 직전에 호출하는 서버 API다. 서버는 `OPENAI_API_KEY`로 OpenAI 단기 키를 발급하고, 앱은 반환된 `clientSecret`만 OpenAI WebRTC 연결에 사용한다.

#### 요청

| 항목 | 위치 | 필수 | 설명 |
| --- | --- | --- | --- |
| `x-realtime-shared-secret` | Header | 예 | 서버 `REALTIME_SHARED_SECRET`과 동일해야 하는 내부 인증 값 |

요청 body는 사용하지 않는다.

#### 성공 응답

```json
{
  "success": true,
  "clientSecret": "ek_...",
  "model": "gpt-realtime-mini",
  "expiresAt": "2026-08-01T12:10:00.000Z",
  "message": "Realtime 세션 키를 발급했습니다.",
  "timestamp": "2026-08-01T12:00:00.000Z"
}
```

#### 실패 응답

| HTTP | `errorCode` | 조건 |
| --- | --- | --- |
| `401` | `UNAUTHORIZED` | 요청 헤더의 공유 비밀이 없거나 서버 값과 다름 |
| `401` | `UNAUTHORIZED` | 서버 `OPENAI_API_KEY`가 비어 있음 |
| `500` | `SERVER_CONFIG_ERROR` | 서버 `REALTIME_SHARED_SECRET`이 설정되지 않아 세션 발급을 거부함 |
| `502` | `REALTIME_SESSION_FAILED` | OpenAI 단기 키 발급 실패 또는 응답 형식 오류 |

`REALTIME_SHARED_SECRET`은 비어 있으면 안 된다. 값이 없을 때 세션 발급 API를 인증 없이 열지 않고 서버 설정 오류로 거부한다.

### Realtime WebRTC 연결

앱은 `/api/realtime/session`에서 받은 `clientSecret`을 Bearer 토큰으로 사용해 OpenAI Realtime WebRTC에 연결한다. ephemeral key 방식에서는 SDP offer 원문을 `Content-Type: application/sdp` body로 전송하고, SDP answer를 받아 `RTCPeerConnection`에 설정한다. WebRTC 연결 이후 앱이 `instructions`와 Function schema를 세션에 등록한다.

## 상태·하차벨 계약

- `PATCH /status`만 위치를 반영하고 상태를 계산한다. `GET /status`는 조회 전용이며 항상 `shouldTriggerBell: false`, `command: null`을 반환한다.
- `remainingStations = 2`는 사전 안내만 하며 하차벨을 만들지 않는다.
- `remainingStations = 1`과 `bellStatus = NOT_REQUESTED`에서만 백엔드가 `bellRequestId`, `command: "STOP_REQUEST"`, `shouldTriggerBell: true`를 반환하고 `bellStatus`를 `PENDING`으로 바꾼다.
- `POST /bell/result`는 `PENDING`인 동일 `bellRequestId` 결과만 기록한다. 다른 상태는 `409 INVALID_BELL_STATE`다.
- 종료 운행(`CANCELLED`, `TRIP_DONE`)은 새 `requestId`의 `PATCH /status`를 `409 INVALID_TRIP_STATUS`로 거부한다. 이미 처리한 동일 `requestId` 재전송은 종료 상태보다 먼저 멱등 처리해 `200`을 반환한다.

## 구현 및 변경 관리

API 경로·필드·enum 변경 시 `packages/shared`, 서버, 앱 Dispatcher, 테스트, 이 문서와 Notion 공통 명세를 같은 변경 단위로 동기화한다. 코드와 계약이 다르면 실제 코드 동작과 목표 계약을 분리해 PR에 남긴다.
