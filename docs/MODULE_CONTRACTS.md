# 모듈 계약과 책임 경계

> 문서 상태: 최종 개발 기준. API 형식은 [API_SPEC.md](API_SPEC.md), 상태값은 [DB_SCHEMA.md](DB_SCHEMA.md)를 따른다.

## 책임 경계

| 모듈 | 담당 | 담당하지 않는 일 |
| --- | --- | --- |
| 앱·Function Dispatcher | 사용자 입력, Realtime 이벤트 수신, REST 변환, 앱 상태·BLE 제어 | 경로·운행 상태의 임의 판단 |
| GPT-Realtime mini | 의도 이해, 정의된 Function 선택, 결과 음성 안내 | `tripId`·좌표·상태 생성, 외부 API 직접 호출 |
| 백엔드 | 경로·도착정보·운행·하차벨·세션 키 처리 | API 키를 앱에 전달, 모델에 상태 판정 위임 |
| `packages/shared` | 타입, enum, API 경로, Zod 검증의 공통 기준 | 서버와 앱이 별개 계약을 갖도록 방치 |
| 하드웨어 | 비콘·스마트지팡이·하차벨 동작과 결과 전달 | 공개 API가 확정되지 않은 감지 로그의 저장을 완료로 표시 |

## 경로와 도착정보

서버는 경로 검색에서 후보를 검증하고, 사용자가 선택한 후보 하나를 `POST /api/trips` 안에서 도착정보 조회에 사용한다. 후보에는 `candidateId`, `routeNo`, `localBusId`, `gbisStationId`, 정류장 목록과 좌표가 포함된다. 정류장 객체에 구버전 `stationId`, `routeDirection`, `endStationName`을 공개 계약으로 추가하지 않는다.

## Realtime 연동

1. 백엔드는 단기 키만 발급한다.
2. 앱은 WebRTC 연결 뒤 instructions와 tools를 설정한다.
3. 모델의 Function 호출은 앱 Dispatcher가 REST 요청으로 변환한다.
4. GPS·하차벨 같은 자동 이벤트는 모델 호출을 기다리지 않고 앱이 API 처리 후 변화가 있을 때 세션에 주입한다.
5. Realtime 세션의 대화 기억은 저장소가 아니다. `tripId`, 선택 후보 및 실제 운행 상태의 기준은 앱 상태와 백엔드 데이터다.

## 하드웨어 연동

`GET /api/beacons?routeNo=`의 `targetBeaconId`는 스마트지팡이 대상 식별에 사용한다. 하차벨 명령은 `PATCH /status` 응답의 `shouldTriggerBell`, `bellRequestId`, `command: STOP_REQUEST`를 사용할 때만 전송한다. 처리 결과는 같은 `bellRequestId`로 서버에 기록한다. 비콘 RSSI·감지 결과를 백엔드에 저장하는 공개 계약은 미확정이다.

## 변경 영향

공개 API, 공유 타입, enum, DB 컬럼, Function 입력을 바꾸면 영향을 받는 앱·서버·AI·하드웨어 소비자를 확인한다. API Path·메서드 변경은 Dispatcher 변환도, 상태 전이 변경은 shared 타입·DB 제약·응답 처리도 함께 갱신한다.
