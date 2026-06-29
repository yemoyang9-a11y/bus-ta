# 기능 요구사항

이 문서는 최신 Notion 확정 규칙을 기준으로 기능별 요구사항을 정리합니다. 현재 브랜치에는 초기 모노레포 스캐폴드가 있으나, 기능별 실제 구현 완료 여부는 코드와 실행 결과 기준으로 추가 확인이 필요합니다.

## 상태 기준

- `초안`: 구현 전 설계 단계
- `진행 중`: 일부 코드 또는 시연 흐름이 있음
- `완료`: 코드, 테스트, 문서가 확인됨
- `확인 필요`: 현재 저장소에서 판단할 수 없음

## 음성 목적지 입력

- 기능 설명: 사용자가 목적지를 음성으로 입력한다.
- 입력값: 사용자 음성
- 처리 내용: STT로 음성을 텍스트로 변환하고 백엔드 API의 `destination`으로 전달한다.
- 출력값: 목적지 텍스트
- 성공 조건: `destination` 값이 생성된다.
- 실패 조건: 마이크 권한 없음, 음성 인식 실패, 네트워크 오류
- 우선순위: 높음
- 구현 상태: 확인 필요

## 경로 후보 검색

- 기능 설명: 목적지와 현재 좌표를 기반으로 직행 버스 경로 후보를 검색한다.
- 입력값: `destination`, `latitude`, `longitude`
- 처리 내용: 카카오 로컬 API로 목적지 좌표 변환 후 효린 `searchRoutes()`를 호출하고 ODsay 경로 후보를 조회한다.
- 출력값: 검증된 경로 후보 배열
- 성공 조건: `stationList`가 포함된 경로 후보가 반환된다.
- 실패 조건: 목적지 좌표 변환 실패, ODsay 오류, 직행 후보 없음
- 우선순위: 높음
- 구현 상태: 확인 필요

## AI 최종 후보 선택

- 기능 설명: OpenAI가 검증된 후보 중 최종 후보 2개를 선택한다.
- 입력값: 경로 후보 배열
- 처리 내용: 환승 횟수, 도보 이동, 소요시간, 이동 구조 단순성을 기준으로 후보를 선택한다.
- 출력값: 최종 후보 2개, `recommendationReason`, `guideMessage`
- 성공 조건: 반환된 `candidateId`가 실제 후보 배열에 존재한다.
- 실패 조건: OpenAI 호출 실패, 잘못된 ID 반환
- 우선순위: 높음
- 구현 상태: 확인 필요

## 운행 생성

- 기능 설명: 사용자가 선택한 최종 후보로 운행을 생성한다.
- 입력값: `destination`, `candidateId`, `routeNo`, `localBusId`, `gbisStationId`, `boardingStation`, `destinationStation`, `stationList`
- 처리 내용: 직전 후보 존재 여부 확인, `stationList` 검증, 내부 `getArrivalInfo(selectedCandidate)` 호출, DB 저장
- 출력값: `tripId`, `tripStatus`, `bellStatus`, `gbisStationId`, `predictedArrivalMinutes`
- 성공 조건: `tripStatus = WAITING_BUS`, `bellStatus = NOT_REQUESTED`로 생성된다.
- 실패 조건: 선택 경로 없음, 전체 정류장 목록 누락, DB 오류
- 우선순위: 높음
- 구현 상태: 확인 필요

## 위치 업데이트

- 기능 설명: 앱이 GPS 또는 mock GPS 좌표를 전송한다.
- 입력값: `requestId`, `latitude`, `longitude`, `recordedAt`, `source`, `isMock`
- 처리 내용: 현재 정류장, 다음 정류장, 남은 정류장 수 계산 및 DB 갱신
- 출력값: 최신 운행 상태
- 성공 조건: `remainingStations`, `currentStation`, `nextStation`이 계산된다.
- 실패 조건: 잘못된 좌표, 존재하지 않는 `tripId`, 잘못된 상태 전환
- 우선순위: 높음
- 구현 상태: 확인 필요

## 상태 조회

- 기능 설명: 앱이 현재 저장된 운행 상태를 조회한다.
- 입력값: `tripId`
- 처리 내용: DB에 저장된 현재·다음·남은 정류장과 하차벨 상태를 반환한다.
- 출력값: `tripStatus`, `remainingStations`, `bellStatus`, `guideMessage`
- 성공 조건: 화면과 TTS에 필요한 상태가 반환된다.
- 실패 조건: 존재하지 않는 `tripId`
- 우선순위: 높음
- 구현 상태: 확인 필요

## 하차 판단 및 하차벨 신호

- 기능 설명: 남은 정류장 수와 하차벨 상태를 기준으로 하차벨 신호를 생성한다.
- 입력값: `remainingStations`, `bellStatus`
- 처리 내용: 2정거장 전 사전 안내, 1정거장 전 `bellRequestId`와 `STOP_REQUEST` 생성
- 출력값: `shouldTriggerBell`, `bellRequestId`, `command`, `bellStatus`
- 성공 조건: 하차벨 신호가 중복 생성되지 않는다.
- 실패 조건: 하차벨 결과 미저장, 중복 요청, 잘못된 상태 전환
- 우선순위: 높음
- 구현 상태: 확인 필요

## 하차벨 결과 저장

- 기능 설명: 앱이 실제 BLE 또는 mock 하차벨 처리 결과를 백엔드에 저장한다.
- 입력값: `bellRequestId`, `command`, `result`, `resultMessage`, `isMock`, `timestamp`
- 처리 내용: `bellStatus`를 `SUCCESS` 또는 `FAIL`로 갱신한다.
- 출력값: 갱신된 `bellStatus`
- 성공 조건: 이후 `shouldTriggerBell = false`가 반환된다.
- 실패 조건: 잘못된 `bellRequestId`, 이미 종료된 운행, 잘못된 결과값
- 우선순위: 높음
- 구현 상태: 확인 필요

## mock 비콘 조회

- 기능 설명: 중간평가에서 노선별 mock 비콘 ID를 반환한다.
- 입력값: `routeNo`
- 처리 내용: `MOCK_BUS_{routeToken}_{vehicleToken}` 형식의 `targetBeaconId` 반환
- 출력값: `targetBeaconId`, `isMock`
- 성공 조건: 예: `MOCK_BUS_7002_001` 형식으로 반환된다.
- 실패 조건: `routeNo` 누락, 매칭 없음
- 우선순위: 중간
- 구현 상태: 확인 필요

## 최종 하드웨어 연동

- 기능 설명: 스마트지팡이 ESP32와 하차벨 모형을 실제 BLE로 연동한다.
- 입력값: `targetBeaconId`, RSSI, `STOP_REQUEST`
- 처리 내용: BLE 스캔, RSSI 측정, 진동 제어, LED/부저 작동
- 출력값: 진동 또는 하차벨 신호
- 성공 조건: 실제 하드웨어가 앱 흐름과 연결된다.
- 실패 조건: BLE 연결 실패, 전원 문제, 하드웨어 미도착
- 우선순위: 중간평가 이후
- 구현 상태: 확인 필요
