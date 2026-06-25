# 모듈 계약

이 문서는 백엔드가 팀원별 모듈을 호출할 때 지켜야 하는 입력·출력 계약을 정리합니다. 최신 기준은 2026-06-25 Notion 확정 내용입니다.

## 효린 지도·버스 API 모듈

파일명은 실제 구현 시 확인이 필요하지만, Notion 기준 예시는 `routeSearch.js`입니다.

백엔드 import 예시:

```javascript
const { searchRoutes, getArrivalInfo } = require("./routeSearch");
```

### searchRoutes(destination, latitude, longitude)

역할:

- 사용자 입력 목적지와 현재 위치 좌표를 기반으로 직행 버스 후보를 반환합니다.
- 카카오 로컬 API로 목적지 좌표를 변환합니다.
- ODsay `searchPubTransPathT`로 대중교통 경로 후보를 조회합니다.
- 중간평가에서는 환승 없는 직행 버스 후보만 반환합니다.
- ODsay 내부 경로 유형 값은 모듈 내부 판단에만 사용하고 공개 API·DB로 전달하지 않습니다.

호출 예시:

```javascript
const result = await searchRoutes("수원대학교", 37.2433596329495, 126.963902835862);
```

반환 예시:

```json
{
  "candidates": [
    {
      "candidateId": 1,
      "routeNo": "700-2",
      "localBusId": "234000021",
      "gbisStationId": "201000166",
      "boardingStation": {
        "stationName": "오목천역.영신여자고교.청구아파트",
        "latitude": 37.242027,
        "longitude": 126.962801
      },
      "destinationStation": {
        "stationName": "수원대학교",
        "latitude": 37.213789,
        "longitude": 126.979749
      },
      "stationList": [
        {
          "stationName": "오목천역.영신여자고교.청구아파트",
          "latitude": 37.242027,
          "longitude": 126.962801,
          "sequence": 0
        },
        {
          "stationName": "수영오거리.방송통신대입구",
          "latitude": 37.237447,
          "longitude": 126.962515,
          "sequence": 1
        },
        {
          "stationName": "수원대학교",
          "latitude": 37.213789,
          "longitude": 126.979749,
          "sequence": 10
        }
      ],
      "totalTime": 30,
      "totalWalk": 825,
      "payment": 1650,
      "busTransitCount": 1,
      "busStationCount": 10,
      "totalDistance": 4653,
      "intervalTime": 15
    }
  ]
}
```

규칙:

- `searchRoutes()`는 실시간 도착 예정 시간인 `predictedArrivalMinutes`를 반환하지 않습니다.
- 도착 예정 시간은 사용자가 후보를 선택한 뒤 `getArrivalInfo(selectedCandidate)`에서 조회합니다.
- 정류장 객체에는 `stationId`를 포함하지 않습니다.
- `destinationStation.stationName`은 사용자가 입력한 목적지명과 다를 수 있습니다.
- 백엔드는 `stationList`가 전체 구간인지 검증해야 합니다.

### getArrivalInfo(selectedCandidate)

역할:

- 사용자가 후보를 선택한 직후 `selectedCandidate` 객체를 받아 실시간 도착 예정 시간을 조회합니다.
- `selectedCandidate.gbisStationId`를 GBIS `getBusArrivalListv2`의 `stationId`로 사용합니다.
- 도착정보 목록에서 `selectedCandidate.localBusId`와 일치하는 버스를 찾습니다.

호출 예시:

```javascript
const arrival = await getArrivalInfo(selectedCandidate);
```

전달값:

```text
selectedCandidate.gbisStationId = ODsay startLocalStationID (= GBIS stationId)
selectedCandidate.localBusId    = ODsay busLocalBlID (= GBIS routeId 형식)
```

반환 예시:

```json
{
  "gbisStationId": "201000166",
  "localBusId": "234000021",
  "predictedArrivalMinutes": 6
}
```

조회 실패 시:

```json
{
  "gbisStationId": "201000166",
  "localBusId": "234000021",
  "predictedArrivalMinutes": null
}
```

규칙:

- 조회 실패는 운행 생성 실패 사유가 아닙니다.
- `predictedArrivalMinutes`가 `null`이어도 `POST /api/trips`는 계속 진행합니다.
- `getArrivalInfo()`에는 좌표와 `routeId`를 개별 인자로 전달하지 않습니다.

## 유나 OpenAI 안내 모듈

유나 모듈은 외부 REST API가 아니라 백엔드 내부에서 import해 사용하는 함수형 모듈입니다.

예상 파일명: `guide.js`

백엔드 import 예시:

```javascript
const {
  selectRecommendedRoutes,
  generateTripStartGuide,
  generateMovingGuide,
  generateErrorGuide
} = require("./guide");
```

### selectRecommendedRoutes({ destination, routes })

역할:

- 검증된 실제 후보 배열 중 최종 후보 2개를 선택합니다.
- 각 후보의 `recommendationReason`과 `guideMessage`를 생성합니다.

선택 기준:

- 환승 횟수가 적은 경로
- 도보 이동이 짧은 경로
- 총 소요시간이 지나치게 길지 않은 경로
- 이동 구조와 정류장 구성이 단순한 경로

반환 예시:

```json
{
  "summaryGuideMessage": "환승 없이 이동 가능한 경로 2개를 찾았습니다.",
  "routes": [
    {
      "candidateId": 1,
      "recommendationReason": "환승이 없고 이동 구조가 단순합니다.",
      "guideMessage": "첫 번째 경로는 환승 없이 이동할 수 있습니다."
    }
  ]
}
```

백엔드 검증:

- OpenAI가 반환한 `candidateId`가 실제 후보 배열에 존재하는지 확인합니다.
- 잘못된 ID를 반환하거나 OpenAI 호출이 실패하면 백엔드 기본 점수 규칙으로 상위 후보를 선택합니다.

### generateTripStartGuide({ selectedRoute, tripStatus, predictedArrivalMinutes })

역할:

- 사용자가 노선을 선택한 뒤 탑승 대기 안내 문장을 생성합니다.
- `POST /api/trips` 응답의 `guideMessage`로 사용할 수 있습니다.

규칙:

- 선택한 버스 번호와 탑승 정류장을 안내합니다.
- 도착 예정 시간이 있으면 약 N분 후 도착 예정이라고 안내합니다.
- 도착 예정 시간이 없으면 시간 안내를 생략합니다.
- 하차벨 상태값 자체를 사용자에게 읽지 않습니다.

### generateMovingGuide({ currentStation, nextStation, remainingStations, tripStatus })

역할:

- 탑승 중 이동 상태 안내 문장을 생성합니다.
- `PATCH /api/trips/{tripId}/status`에서 상태 변화가 발생한 경우 호출할 수 있습니다.
- `GET /api/trips/{tripId}/status`는 매번 OpenAI를 호출하지 않고 저장 또는 캐시된 `guideMessage`를 반환하는 것을 권장합니다.

규칙:

- `remainingStations = 2`: 목적지까지 두 정류장 남았고 미리 준비하라고 안내합니다.
- `remainingStations = 1`: 하차까지 한 정류장 남았고 다음 정류장에서 하차하라고 안내합니다.
- `remainingStations = 0`: 목적지 도착 안내를 합니다.
- 하차벨 성공, 실패, 요청 완료 여부는 안내하지 않습니다.
- `shouldTriggerBell`은 유나 모듈의 문장 생성 입력으로 사용하지 않습니다.

### generateErrorGuide({ errorType })

역할:

- 오류 상황 fallback 문장을 반환합니다.
- OpenAI API를 호출하지 않아도 동작해야 합니다.

예시:

```json
{
  "guideMessage": "일시적인 오류가 발생했어요. 다시 시도해 주세요."
}
```

## 백엔드 내부 검증 책임

- `stationList` 전체 구간 검증
- `candidateId` 실제 후보 존재 여부 검증
- `getArrivalInfo(selectedCandidate)` 호출 방식 준수
- OpenAI 실패 시 fallback 선택
- GBIS 도착정보 실패 시 null 저장
- 하차벨 중복 방지
- 공개 API와 DB에 내부 전용 경로 유형 값이 섞이지 않도록 차단
