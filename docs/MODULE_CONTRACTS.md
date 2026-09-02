# 모듈 계약과 책임 경계

> 문서 상태: 최종 개발 기준. API 형식은 [API_SPEC.md](API_SPEC.md), 상태값은 [DB_SCHEMA.md](DB_SCHEMA.md)를 따른다.

## 책임 경계

| 모듈 | 담당 | 담당하지 않는 일 |
| --- | --- | --- |
| 앱·Function Dispatcher | 사용자 입력, Realtime 이벤트 수신, REST 변환, 서버 성공 응답의 앱 상태 반영 | 서버 응답 전 `ON_BUS` 확정 |
| 프론트 BLE | BLE 원시 신호 수집, 필터링, 자동 탑승 여부의 최종 알고리즘 판정, `AUTO_DETECTED` API 호출 | DB 상태 직접 변경, 하차벨 조기 생성 |
| GPT-Realtime mini | 의도 이해, 정의된 Function 선택, 결과 음성 안내 | `tripId`·좌표·상태 생성, 외부 API 직접 호출 |
| 백엔드 | 탑승 근거 원자 저장, 권위 상태 전환, 경로·도착정보·운행·하차벨·세션 키 처리 | BLE 원시 신호 수집·자동 판정 알고리즘, API 키를 앱에 전달 |
| `packages/shared` | 타입, enum, API 경로, Zod 검증의 공통 기준 | 서버와 앱이 별개 계약을 갖도록 방치 |
| 하드웨어 | 비콘·스마트지팡이·하차벨 동작과 결과 전달 | 공개 API가 확정되지 않은 감지 로그의 저장을 완료로 표시 |

## 경로와 도착정보

서버는 경로 검색에서 후보를 검증하고, 사용자가 선택한 후보 하나를 `POST /api/trips` 안에서 도착정보 조회에 사용한다. 후보에는 `candidateId`, `routeNo`, `localBusId`, `gbisStationId`, 정류장 목록과 좌표가 포함된다. 정류장 객체에 구버전 `stationId`, `routeDirection`, `endStationName`을 공개 계약으로 추가하지 않는다.

사용자가 버스를 놓쳤다고 말하면 Dispatcher는 `GET /api/trips/{tripId}/status`를 새로 호출한다. 서버는 저장된 선택 노선 식별자로 GBIS를 재조회하고 `arrivals`와 `arrivalStatus`를 반환한다. `AVAILABLE`, `NO_VEHICLE`, `UPSTREAM_ERROR`를 구분하며, 이전 도착시간을 재사용하지 않는다. 방향 판별에 실패해 fail-closed로 접은 결과는 `NO_VEHICLE`이 아니라 `UPSTREAM_ERROR`다. 이 조회는 운행·하차벨 상태를 변경하지 않는다.

## Realtime 연동

1. 백엔드는 단기 키만 발급한다.
2. 앱은 WebRTC 연결 뒤 instructions와 tools를 설정한다.
3. 모델의 Function 호출은 앱 Dispatcher가 REST 요청으로 변환한다.
4. GPS·하차벨 같은 자동 이벤트는 모델 호출을 기다리지 않고 앱이 API 처리 후 변화가 있을 때 세션에 주입한다.
5. Realtime 세션의 대화 기억은 저장소가 아니다. `tripId`, 선택 후보 및 실제 운행 상태의 기준은 앱 상태와 백엔드 데이터다.
6. 사용자가 버스에 탔다고 명시하면 모델은 `confirm_boarding`을 호출한다. Dispatcher가 활성 `tripId`, 전용 `requestId`, `USER_CONFIRMED`를 채우며 BLE·GPS 재확인은 하지 않는다.
7. 서버 성공 전에는 AI와 앱 모두 탑승 완료로 안내·표시하지 않는다.
8. 탑승확정 응답의 `tripId`가 현재 활성 운행과 다르면 Dispatcher는 앱 상태에 반영하지 않고 stale 응답 오류로 처리한다.

## 하드웨어 연동

`GET /api/beacons?routeNo=`의 `targetBeaconId`는 스마트지팡이 대상 식별에 사용한다. 프론트 BLE는 수집한 신호로 자동 탑승을 최종 판정한 뒤 `AUTO_DETECTED`로 공통 탑승확정 API를 호출한다. 원시 RSSI를 백엔드에 저장하는 공개 계약은 만들지 않는다. 하차벨 명령은 탑승확정 이후 `PATCH /status` 응답의 `shouldTriggerBell`, `bellRequestId`, `command: STOP_REQUEST`를 사용할 때만 전송한다.

## 변경 영향

공개 API, 공유 타입, enum, DB 컬럼, Function 입력을 바꾸면 영향을 받는 앱·서버·AI·하드웨어 소비자를 확인한다. API Path·메서드 변경은 Dispatcher 변환도, 상태 전이 변경은 shared 타입·DB 제약·응답 처리도 함께 갱신한다.
