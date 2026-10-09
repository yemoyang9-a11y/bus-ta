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
- 노선 번호 발음: `routeNo`는 먼저 하이픈(`-`)을 기준으로 나누며, 하이픈 양쪽 숫자를 이어 붙여 전체 자릿수를 계산하지 않는다. 나뉜 각 숫자 덩어리가 네 자리 이상이면 각 숫자를 한 자리씩 읽고(`1551` → "일 오 오 일"), 세 자리 이하면 일반적인 한국어 수 읽기 방식으로 읽는다(`205` → "이백오"). 숫자-숫자 형태에서 하이픈은 반드시 "다시"라고 읽으며(`700-2` → "칠백 다시 이"), 알파벳·하이픈 뒤 숫자·괄호 안 표시를 생략하지 않는다(`1551B` → "일 오 오 일 비", `35-2(A)` → "삼십오 다시 이 에이"). 실제 `routeNo` 데이터는 변경하지 않는다.
- 탑승 대기: `create_trip` 성공은 `WAITING_BUS` 운행 생성이며 실제 탑승 완료가 아니다. 선택 노선·탑승 정류장·첫 도착 예정 시간을 안내하고, `WAITING_BUS`에서는 탑승 완료·탑승 중·운행 시작으로 표현하지 않는다.
- 버스를 놓친 경우: 활성 운행이 `WAITING_BUS`이고 사용자가 선택한 버스를 놓쳤거나 지나갔다고 말하면 `get_trip_status`에 `refreshArrivals: true`를 전달해 다음 차량 정보를 강제로 새로 확인한다. 이 발화만으로 `end_trip`을 호출하지 않는다. 일반 도착시간 질문은 `refreshArrivals`를 생략하거나 `false`로 전달한다.
- 탑승 확인: 사용자가 “버스 탔어요”, “버스 탔어”, “지금 탔습니다”처럼 실제 탑승을 명시하면 `confirm_boarding`을 즉시 호출한다. 이 발화는 충분한 `USER_CONFIRMED` 근거이므로 BLE·GPS 재확인이나 반복 질문을 하지 않는다. Function 성공 전에는 “탑승이 확인되었습니다”라고 말하지 않는다. 응답을 기다리는 동안 활성 운행이 바뀌면 이전 `tripId`의 성공 응답을 현재 앱 상태에 반영하거나 성공으로 안내하지 않는다.
- Function 인자와 역할 경계: 모델은 `confirm_boarding`에 빈 객체만 전달한다. 활성 `tripId`, 탑승확정 전용 `requestId`, `USER_CONFIRMED`는 앱 Dispatcher가 주입한다. BLE 기반 `AUTO_DETECTED` 판정은 프론트엔드·BLE 로직의 책임이며 Realtime Function으로 처리하지 않는다.
- 탑승 상태 반영: 서버 성공 응답의 `boardingConfirmedAt`이 확인된 뒤에만 앱과 AI가 탑승 완료를 표시·안내한다. 최신 운행 상태가 `WAITING_BUS`이면 GPS 진행 정보가 있더라도 탑승으로 해석하지 않는다.
- 도착 예정 시간: 노선 선택 직후에는 `create_trip` 응답의 `arrivals`로 안내한다. 그 이후 "몇 분 남았어요?" 같은 질문에는 반드시 `get_trip_status`를 호출하고 **방금 받은 그 결과만** 근거로 답한다. 서버가 도착정보를 갱신하므로 `create_trip` 때 들었던 값은 이미 낡았고, 앞선 대화에서 말했던 시간을 그대로 반복하지 않는다.
- `arrivalStatus`별 안내: `AVAILABLE`이면 `arrivals[0].predictedArrivalMinutes`를 안내한다. `NO_VEHICLE`이면 조회는 됐고 지금 오는 차가 없다고 안내한다. `NO_PREDICTION`이면 차가 없다고 단정하지 않고 도착시간 정보를 확인할 수 없다고 안내한다. `UPSTREAM_ERROR`이면 지금은 확인할 수 없다고 안내하며, `arrivals`에 값이 남아 있어도 방금 확인한 최신값처럼 말하지 않는다.
- 재조회 플래그: "몇 분 남았어요?" 같은 일반 질문에는 `refreshArrivals`를 붙이지 않는다. "버스 놓쳤어요", "버스 지나갔어요"처럼 명시적인 놓침 발화에만 붙인다.
- "몇 정류장 남았어요?"의 뜻은 탑승 전후가 다르다. `WAITING_BUS`에서는 `remainingStations`가 목적지까지 남은 수라서 버스가 승차 정류장까지 남긴 정류장 수로 말하면 안 된다. 공개 계약에 탑승 전 `stopsAway`가 없으므로 추측하지 말고, 남은 정류장 수는 확인할 수 없다고 밝힌 뒤 최신 도착 예정 시간을 안내한다. `ON_BUS`·`NEAR_DESTINATION`에서는 목적지까지 남은 정류장 수로 안내한다.
- 상태 안내: 저장된 상태 조회 또는 앱 Event Dispatcher가 전달한 실제 변화만 안내한다.
- 자동 임박 안내: 도착 예정 시간이 갱신될 때마다 말하지 않는다. 첫 차량이 `AVAILABLE`이고 2분 이내로 처음 들어온 경계에서만 앱이 이벤트를 만든다(3분 → 2분은 안내, 2분 → 1분은 같은 구간이라 안내 없음). 사용자가 직접 물으면 이 경계와 무관하게 `get_trip_status`의 최신 결과로 답한다.
- 종료·재선택: 사용자가 “안 탈래요”, “다시 고를래요”처럼 현재 선택 취소를 명확히 요청하면 `end_trip`을 호출한다. 성공 결과에 보존된 `routes`가 있으면 `search_routes`를 다시 호출하지 않고 최대 두 개를 다시 안내해 선택을 요청한다. 보존 후보가 없을 때만 다시 검색할지 묻는다. 늦게 도착한 이전 `tripId`의 성공 응답은 현재 운행에 적용하거나 성공으로 안내하지 않는다.
- 오류: 성공을 추정하지 않고 재시도·정보 수정·연결 복구를 안내한다. 서버 내부 오류를 그대로 읽지 않는다.
- 보조기기 오류: 앱이 `assist_device_status_changed` 시스템 이벤트를 전달하면 실제 연결 시도 여부(`attempted`)와 재시도 가능 여부(`retryable`)를 지켜 안내한다. 노선 비콘 미등록·조회 실패는 지팡이 접근 진동 실패로만 안내하고 하차벨 실패로 확대하지 않는다. 실제 하차벨 연결에 실패한 경우에만 내리기 전에 기사님께 직접 말하도록 안내한다.

앱은 목적지, 후보, `tripId`, 운행 여부를 보관하며 Realtime 대화 기억을 유일한 저장소로 쓰지 않는다. 운행의 최종 기준은 백엔드 데이터와 [DB_SCHEMA.md](DB_SCHEMA.md)의 상태 전이다.

## 완료 기준

단기 키 기반 연결·만료 시 재연결, Function 호출·결과 처리, 접근성 음성 안내, 오류 처리, 실제 백엔드 결과만 사용하는 상태 안내가 검증돼야 한다. 아직 계약만 있고 구현되지 않은 세션 엔드포인트나 하드웨어 감지 결과 저장은 완료로 표시하지 않는다.


## 완료 음성과 Function 경계 보완 (2026-09-22)

완료 안내는 Provider의 운행 수명주기가 한 번만 시작한다. `get_trip_status`의 `TRIP_DONE`도 상태를 먼저 전달하고 즉시 RESET하지 않는다. 일반 상태/Function 응답과 완료 음성을 중복 생성하지 않는다. 완료 응답에는 `metadata.completionKey`를 넣고, `response.created`에서 받은 해당 응답 ID에 대해 `response.done(status=completed)`와 `output_audio_buffer.started/stopped`를 함께 확인한다. 다른 응답의 stopped로 완료하지 않는다. 타임아웃·연결 없음에는 로컬 TTS를 사용하고, 로컬 TTS도 유한 시간 뒤 종료한다. 화면의 완료 문구는 실제 하차를 감지했다고 말하지 않는다.

응답 metadata 상관 관계는 [OpenAI Realtime 대화 문서](https://developers.openai.com/api/docs/guides/realtime-conversations)의 계약을 사용한다. 출력 이벤트의 `response_id`는 설치된 OpenAI SDK의 Realtime 타입과 대조했다. 이벤트 시험 통과는 실제 휴대폰 재생 시험과 별개다.

빈 문자열/공백을 `{}`로 정규화하는 Function은 스키마상 무인자인 `confirm_boarding`, `get_next_route_candidates` 두 개뿐이다. 유인자 Function, null, 배열, 깨진 JSON은 거절한다. 같은 call_id의 중복 이벤트는 세션에서 한 번만 처리한다. 늦은 탑승/조회/취소 응답은 현재 운행과 terminal 상태에 맞는지 확인한다.

후보 진단 로그는 저장 개수·안내 개수·만료·반환 개수만 남긴다. 목적지·좌표·전체 인자는 기록하지 않는다. 다음 후보 응답의 `lastBatch`, `remainingCandidateCount`는 모델 안내용 앱 내부 정보이며 공개 API에 추가하지 않는다. 마지막 후보면 마지막임을 알리고 선택을 묻는다. 소진·만료·조회 실패를 구분한다. PR55의 `toSpokenRouteNo`와 `routeNoSpoken` 처리는 보존한다.
