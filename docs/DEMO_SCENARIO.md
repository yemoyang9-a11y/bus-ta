# 시연 시나리오

> 참고 문서: 시연 흐름과 이력을 보존한다. 현재 기능 계약은 [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)와 최종 명세 문서를 우선한다.

이 문서는 7/1 중간평가와 최종평가를 위한 시연 흐름을 정리합니다.

## 중간평가 시연 목표

중간평가에서는 실제 스마트지팡이와 하차벨 하드웨어가 없어도 앱, 백엔드, 외부 API, OpenAI, mock 위치, 하차 판단 흐름이 하나로 연결되는 것을 보여줍니다.

## 시연 1: 앱·API·AI 통합

1. 사용자가 앱에서 목적지를 음성으로 말합니다.
2. STT 결과가 목적지 텍스트로 변환됩니다.
3. 앱이 `destination`, `latitude`, `longitude`를 `POST /api/routes/search`로 전송합니다.
4. 백엔드가 카카오 로컬 API로 목적지 좌표를 변환합니다.
5. 백엔드가 효린 `searchRoutes()`를 호출합니다.
6. 효린 모듈이 ODsay로 경로 후보를 조회합니다.
7. 백엔드가 직행 버스 후보와 `stationList`를 검증합니다.
8. 유나 OpenAI 모듈이 최종 후보 2개와 추천 이유, 안내 문장을 생성합니다.
9. 앱이 최종 후보 2개를 화면에 표시합니다.
10. 앱이 `guideMessage`를 TTS로 출력합니다.
11. 사용자가 원하는 노선을 선택합니다.

## 시연 2: 운행 생성과 GBIS 도착정보 내부 조회

1. 앱이 선택한 후보의 `candidateId`, `routeNo`, `localBusId`, `gbisStationId`, 정류장 정보를 `POST /api/trips`로 전송합니다.
2. 백엔드는 직전 검색 후보에 해당 `candidateId`가 존재하는지 확인합니다.
3. 백엔드는 `stationList`를 검증합니다.
4. 백엔드는 내부에서 `getArrivalInfo(selectedCandidate)`를 호출합니다.
5. GBIS 조회가 성공하면 도착 예정 차량을 최대 2대까지 `arrivals`로 반환하고, 첫 차량의 도착 시간을 DB에 저장합니다.
6. GBIS 조회가 실패해도 `arrivals`를 빈 배열로 두고 운행을 생성합니다.
7. 백엔드는 `tripId`, `tripStatus = WAITING_BUS`, `bellStatus = NOT_REQUESTED`를 반환합니다.
8. 앱은 탑승 대기 안내 문장을 출력합니다.

## 시연 3: mock GPS 이동과 하차 판단

1. 앱 또는 시연 버튼이 3초마다 선택 노선의 정류장 좌표를 mock 위치로 전송합니다.
2. 요청은 `PATCH /api/trips/{tripId}/status`를 사용합니다.
3. 백엔드는 현재 정류장, 다음 정류장, 남은 정류장 수를 계산합니다.
4. `remainingStations = 2`가 되면 사전 안내만 제공합니다.
5. 이때 `shouldTriggerBell = false`입니다.
6. `remainingStations = 1`이고 `bellStatus = NOT_REQUESTED`이면 백엔드가 `bellRequestId`와 `STOP_REQUEST`를 생성합니다.
7. 백엔드는 `bellStatus = PENDING`, `shouldTriggerBell = true`를 반환합니다.
8. 앱은 하차 안내 화면으로 전환하고 TTS 안내를 출력합니다.
9. 앱은 실제 BLE 하차벨에 `STOP_REQUEST`를 전달하고 결과(Notify)를 기다립니다. BLE 연결이 없으면 즉시 실패로 처리합니다.
10. 앱은 `POST /api/trips/{tripId}/bell/result`로 결과를 저장합니다. 이때 `isMock`은 서버가 제공한 값과 실제 BLE 연결 성공 여부를 함께 반영한 값입니다(2026-08-13 확정).
11. 이후 `GET /api/trips/{tripId}/status`에서 `shouldTriggerBell = false`를 확인합니다.

## 시연 4: mock 비콘 확인

1. 앱이 `GET /api/beacons?routeNo=700-2`를 호출합니다.
2. 백엔드는 중간평가용 mock 비콘 ID를 반환합니다.
3. 예시 값은 `MOCK_BUS_7002_001`입니다.
4. 실제 스마트지팡이 BLE 연동은 최종 단계 계획으로 설명합니다.

## 시연 5: 하드웨어 준비 상태 설명

중간평가에서는 실제 하드웨어 작동 대신 다음 내용을 발표합니다.

- 스마트지팡이 전체 구조
- ESP32 BLE Advertising과 Scan 구조
- 선택 노선의 `targetBeaconId` 전달 방식
- RSSI 기반 진동 단계 설계
- `STOP_REQUEST` 하차벨 명령 구조
- 부품 도착 후 mock 신호를 실제 BLE 신호로 교체하는 계획

## 예비 시나리오

외부 API 또는 네트워크 오류에 대비해 다음 예비 시나리오를 준비합니다.

- 카카오 API 실패: 목적지 좌표 변환 실패 안내
- ODsay API 실패: mock 경로 후보 사용
- OpenAI API 실패: 백엔드 기본 점수 규칙과 기본 안내 문장 사용
- GBIS 도착정보 실패: `arrivals`를 빈 배열로 두고 운행 생성
- BLE 실패: 실제 실패(FAIL)로 정직하게 기록하고 결과 화면에 안내 (2026-08-13 확정 — 실패를 성공처럼 감추지 않는다)

## 시연 전 체크리스트

- [ ] `.env`에 실제 API 키가 있고 GitHub에는 올라가지 않는가
- [ ] `POST /api/routes/search` 요청 필드가 문서와 같은가
- [ ] 응답 `routes`가 최종 후보 2개 이하인가
- [ ] 공개 API 응답에 내부 전용 경로 유형 값이 없는가
- [ ] `stationList` 첫 항목과 마지막 항목이 올바른가
- [ ] `POST /api/trips`가 GBIS 실패에도 생성을 계속하는가
- [ ] `PATCH /status` 위치 업데이트와 `GET /status` 상태 조회 역할이 구분되어 있는가
- [ ] 하차벨 신호가 중복 생성되지 않는가
- [ ] `POST /api/trips/{tripId}/bell/result` 호출 후 상태가 `SUCCESS` 또는 `FAIL`로 바뀌는가
