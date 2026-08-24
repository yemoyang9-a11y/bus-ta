# GPT-Realtime mini 개발 가이드

> 적용 모델: `gpt-realtime-mini`. 이 문서는 OpenAI 파트와 앱 Dispatcher가 지켜야 할 최종 역할 경계를 정의한다.

## 역할

Realtime 모델은 음성 대화로 목적지·요청 의도를 파악하고, 필요한 Function을 선택하며, 백엔드 결과를 접근성 친화적으로 안내한다. 모델은 경로·도착정보·현재 정류장·하차 시점·하차벨 결과를 추정하거나 생성하지 않는다.

## 세션과 Function

백엔드가 발급한 단기 키로 앱이 WebRTC 연결을 열고, 앱이 Function 도구와 instructions를 등록한다. 모델 Function은 `search_routes`, `create_trip`, `confirm_boarding`, `get_trip_status`, `end_trip` 다섯 개이며 정확한 입출력과 REST 매핑은 [API_SPEC.md](API_SPEC.md)를 따른다.

모델이 요청에 필요한 정보가 부족하면 질문한다. `tripId`, 선택 후보, 현재 위치, `requestId`는 앱·백엔드 결과에서 받아 사용하며 모델이 만들어 내지 않는다.

## 인증과 WebRTC 연결

앱은 OpenAI 장기 API 키를 직접 보관하지 않는다. 앱은 서버 `POST /api/realtime/session`에 `x-realtime-shared-secret` 헤더를 보내고, 서버가 OpenAI Realtime 단기 키 `clientSecret`을 발급한다.

`REALTIME_SHARED_SECRET`은 `EXPO_PUBLIC_` 환경변수로 노출하지 않는다. 로컬 개발과 EAS 빌드 환경에서 같은 이름의 비공개 환경변수로 설정하고, Expo config `extra`를 통해 앱 런타임에 전달한다.

WebRTC 연결은 ephemeral key 흐름을 따른다. 앱은 SDP offer 원문을 `Content-Type: application/sdp` body로 OpenAI Realtime에 보내고, 반환된 SDP answer를 `RTCPeerConnection`에 설정한다. 연결 후 데이터 채널로 `session.update`, Function 호출 이벤트, Function 결과 이벤트를 주고받는다.

## 대화와 상태 원칙

- 경로 검색: 목적지와 필요한 위치 정보를 확인한 뒤 `search_routes`를 호출한다.
- 경로 선택: 사용자가 명시적으로 선택한 뒤 `create_trip`을 호출한다.
- 탑승 확인: 사용자가 “버스 탔어요”, “버스 탔어”, “지금 탔습니다”처럼 실제 탑승을 명시하면 `confirm_boarding`을 즉시 호출한다. 이 발화는 충분한 `USER_CONFIRMED` 근거이므로 BLE·GPS 재확인이나 반복 질문을 하지 않는다. Function 성공 전에는 “탑승이 확인되었습니다”라고 말하지 않는다. 응답을 기다리는 동안 활성 운행이 바뀌면 이전 `tripId`의 성공 응답을 현재 앱 상태에 반영하거나 성공으로 안내하지 않는다.
- 상태 안내: 저장된 상태 조회 또는 앱 Event Dispatcher가 전달한 실제 변화만 안내한다.
- 종료: 사용자의 명시적 요청에만 `end_trip`을 호출한다.
- 오류: 성공을 추정하지 않고 재시도·정보 수정·연결 복구를 안내한다. 서버 내부 오류를 그대로 읽지 않는다.

앱은 목적지, 후보, `tripId`, 운행 여부를 보관하며 Realtime 대화 기억을 유일한 저장소로 쓰지 않는다. 운행의 최종 기준은 백엔드 데이터와 [DB_SCHEMA.md](DB_SCHEMA.md)의 상태 전이다.

## 완료 기준

단기 키 기반 연결·만료 시 재연결, Function 호출·결과 처리, 접근성 음성 안내, 오류 처리, 실제 백엔드 결과만 사용하는 상태 안내가 검증돼야 한다. 아직 계약만 있고 구현되지 않은 세션 엔드포인트나 하드웨어 감지 결과 저장은 완료로 표시하지 않는다.
