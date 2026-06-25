# 개발 계획

이 문서는 중간평가와 최종평가를 기준으로 개발 범위를 정리합니다. 7/1 중간평가의 상세 범위는 [MIDTERM_SCOPE.md](MIDTERM_SCOPE.md)를 우선합니다.

## 중간평가 전 구현 범위

- 음성 입력과 STT 목적지 변환
- `POST /api/routes/search` 연동
- 카카오 로컬 API 목적지 좌표 변환
- 효린 `searchRoutes()`를 통한 ODsay 직행 버스 후보 조회
- 백엔드의 후보 필드와 `stationList` 검증
- 유나 OpenAI 모듈의 최종 후보 2개 선택 및 안내 문장 생성
- 앱의 경로 후보 표시와 사용자 선택
- `POST /api/trips` 운행 생성
- 운행 생성 내부 `getArrivalInfo(selectedCandidate)` 호출과 GBIS 도착정보 저장
- mock GPS 위치 업데이트
- 현재·다음·남은 정류장 계산
- 하차 2정거장 전 사전 안내
- 하차 1정거장 전 `STOP_REQUEST` 생성
- TTS 안내
- mock 비콘과 mock 하차벨 결과 저장

## 중간평가 이후 구현 범위

- 실제 앱 ↔ 스마트지팡이 ESP32 BLE 연결
- 실제 `targetBeaconId` 전달
- BLE 비콘 스캔과 RSSI 측정
- 거리 단계에 따른 진동 세기 제어
- 실제 하차벨 LED·부저 작동
- 차량 단위 `vehicleId`와 비콘 ID 매칭
- 환승 포함 다중 경로 탐색
- 사용자 인증과 사용자별 운행 기록

## 최종평가 전 구현 범위

- 실제 시연 가능한 전체 사용자 흐름 완성
- 프론트엔드, 백엔드, 외부 API, OpenAI, DB, BLE 통합 테스트
- 스마트지팡이 진동과 하차벨 모형 시연
- 발표용 시연 시나리오 작성
- 실패 상황 대체 흐름 준비
- 문서와 코드의 API 명세 일치 확인

## 기능별 우선순위

- 1순위: 목적지 입력, 경로 검색, 최종 후보 2개 안내, 운행 생성
- 2순위: 위치 업데이트, 현재·다음·남은 정류장 계산, 하차 판단
- 3순위: mock 비콘, mock 하차벨 결과 저장, TTS 안내
- 4순위: 실제 BLE, ESP32, RSSI 진동, 실물 하차벨

## 프론트엔드 작업

- 음성 입력 화면 구성
- STT 결과 확인 UI 구성
- 경로 후보 2개 표시
- 선택 경로 운행 생성 호출
- 탑승 중 화면에서 현재·다음·남은 정류장 표시
- 3초 간격 mock 위치 전송
- 하차 안내 화면 전환
- TTS 안내 출력
- 하차벨 결과 저장 API 호출

## 백엔드 작업

- Express 서버 기본 구조 작성
- `GET /api/health`
- `POST /api/routes/search`
- `POST /api/trips`
- `PATCH /api/trips/{tripId}/status`
- `GET /api/trips/{tripId}/status`
- `GET /api/beacons?routeNo=`
- `POST /api/trips/{tripId}/bell/result`
- Supabase 테이블 적용
- 효린·유나 모듈 연결

## 하드웨어 작업

- ESP32 BLE Advertising 코드 작성
- ESP32 BLE Scan 코드 작성
- RSSI 단계 기준 정리
- 스마트지팡이 진동 모터 제어 설계
- 하차벨 LED·부저 회로 설계
- 부품 도착 후 실제 연동 계획 작성

## API 연동 작업

- 카카오 로컬 API 키 설정
- ODsay API 키 설정
- GBIS 서비스 키 설정
- OpenAI API 키 설정
- `.env.example`과 실제 `.env` 분리
- API 요청/응답 필드명 일치 확인

## 통합 테스트

- 목적지 음성 입력부터 경로 후보 표시까지 테스트
- 경로 선택 후 운행 생성 테스트
- GBIS 도착정보 실패 시 null 허용 테스트
- mock 위치 업데이트 테스트
- `remainingStations` 2, 1, 0 케이스 테스트
- 하차벨 결과 저장 후 중복 방지 테스트

## 발표 및 시연 준비

- 중간평가용 소프트웨어 시연 흐름 준비
- 외부 API 실패 대비 mock 응답 준비
- 하드웨어 최종 구조 발표 자료 준비
- 부품 배송 일정과 연동 계획 정리
- 문서와 코드 불일치 확인
