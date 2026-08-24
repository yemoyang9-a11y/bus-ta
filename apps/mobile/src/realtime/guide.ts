export const HANEUM_REALTIME_MODEL = "gpt-realtime-mini";

export const HANEUM_REALTIME_READY_INSTRUCTIONS =
  '세션 시작 안내로 "버스 도우미를 시작합니다. 목적지를 말씀해주세요."라고 정확히 한 번만 말한다. 다른 문장은 덧붙이지 않는다.';

export const HANEUM_REALTIME_INSTRUCTIONS = `
당신은 시각장애인의 버스 탑승과 하차를 돕는 한이음 음성 안내 도우미다.

말하기 원칙:
- 짧고 명확한 한국어로 말한다.
- 결론과 중요한 정보를 먼저 말한다.
- 버스 번호, 승차 정류장, 하차 정류장은 또렷하게 안내한다.
- 사용자가 화면을 보지 않아도 이해할 수 있게 말한다.
- routeId, candidateId, tripId, localBusId, gbisStationId, tripStatus, bellStatus, errorCode 같은 내부 필드명은 그대로 읽지 않는다.

판단 원칙:
- 실제 경로, 도착 예정 시간, 현재 정류장, 다음 정류장, 남은 정류장 수, 하차 시점, 하차벨 성공 여부는 백엔드 응답만 근거로 안내한다.
- 백엔드 응답에 없는 정보는 추측하거나 만들어내지 않는다.
- Function 호출에 필요한 정보가 부족하면 임의 값을 채우지 말고 사용자에게 짧게 추가 질문한다.
- 사용자가 명시적으로 경로를 선택하기 전에는 create_trip을 호출하지 않는다.
- Function 실행이 완료되기 전에는 성공했다고 안내하지 않는다.
- Function 호출 실패를 성공으로 추정하지 않는다.

Function 사용 규칙:
- search_routes는 목적지가 확정되고 앱이 현재 위치를 확보했을 때만 경로 후보 검색에 사용한다. 현재 위치 좌표는 앱 Dispatcher가 넣으며 모델이 직접 만들지 않는다.
- create_trip은 search_routes 결과 중 사용자가 특정 후보를 명확히 선택한 뒤에만 사용한다.
- 사용자가 "버스 탔어요", "버스 탔어", "지금 탔습니다"처럼 실제 탑승을 명시적으로 말하면 confirm_boarding을 즉시 호출한다. 이 발화는 USER_CONFIRMED의 충분한 근거이므로 BLE나 GPS로 재확인하거나 같은 질문을 반복하지 않는다.
- confirm_boarding 성공 응답을 받기 전에는 탑승이 확인됐다고 안내하지 않는다.
- get_trip_status는 진행 중인 운행의 최신 상태를 확인할 때 사용한다.
- end_trip은 사용자가 운행 안내 종료나 취소를 명확히 요청할 때만 사용한다.
- 별도 공개 도착정보 Function은 만들지 않는다. 도착 예정 시간은 create_trip 백엔드 응답 arrivals 배열의 predictedArrivalMinutes만 사용한다.
- arrivals는 도착 순서대로 최대 두 대다. 가장 먼저 오는 차량을 기준으로 안내하고, 두 번째 차량은 사용자가 물어볼 때만 말한다. arrivals가 비어 있으면 도착 시간 언급을 생략한다.
`.trim();

export const HANEUM_REALTIME_TOOLS = [
  {
    type: "function",
    name: "search_routes",
    description:
      "사용자의 목적지와 앱 Dispatcher가 확보한 현재 위치로 직행 버스 경로 후보를 검색한다. 모델은 좌표를 만들지 않고 목적지만 전달한다. 목적지가 비어 있거나 모호하면 호출하지 말고 추가 질문한다.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        destination: {
          type: "string",
          description: "사용자가 가고 싶은 목적지 이름. 모호하지 않게 확정된 문자열이어야 한다.",
        },
      },
      required: ["destination"],
    },
  },
  {
    type: "function",
    name: "create_trip",
    description:
      "사용자가 search_routes 결과 중 특정 경로 후보를 명확히 선택한 뒤 운행 안내를 생성한다. candidateId만 보내는 함수가 아니며, 선택된 route 후보 객체 전체를 그대로 전달해야 한다.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        destination: { type: "string", description: "확정된 목적지 이름." },
        candidateId: { type: "integer", description: "search_routes가 반환한 후보 식별자." },
        routeNo: { type: "string", description: "사용자에게 안내할 버스 노선 번호." },
        localBusId: { type: "string", description: "백엔드와 외부 버스 API가 사용하는 노선 식별자." },
        gbisStationId: { type: "string", description: "승차 정류장의 GBIS 식별자." },
        boardingStation: { $ref: "#/$defs/station" },
        destinationStation: { $ref: "#/$defs/station" },
        stationList: {
          type: "array",
          minItems: 2,
          items: { $ref: "#/$defs/stationListItem" },
          description: "백엔드가 상태 계산에 사용하는 정류장 목록. 모델이 재조립하거나 수정하면 안 된다.",
        },
        totalTime: { type: "integer" },
        totalWalk: { type: "integer" },
        payment: { type: "integer" },
        busTransitCount: { type: "integer" },
        busStationCount: { type: "integer" },
        totalDistance: { type: "integer" },
        intervalTime: { type: "integer" },
      },
      required: [
        "destination",
        "candidateId",
        "routeNo",
        "localBusId",
        "gbisStationId",
        "boardingStation",
        "destinationStation",
        "stationList",
      ],
      $defs: {
        station: {
          type: "object",
          additionalProperties: false,
          properties: {
            stationName: { type: "string" },
            latitude: { type: "number" },
            longitude: { type: "number" },
            sequence: { type: "integer" },
          },
          required: ["stationName", "latitude", "longitude"],
        },
        stationListItem: {
          type: "object",
          additionalProperties: false,
          properties: {
            stationName: { type: "string" },
            latitude: { type: "number" },
            longitude: { type: "number" },
            sequence: { type: "integer" },
          },
          required: ["stationName", "latitude", "longitude", "sequence"],
        },
      },
    },
  },
  {
    type: "function",
    name: "confirm_boarding",
    description:
      "사용자가 버스에 탔다고 명시적으로 말했을 때 현재 운행의 탑승을 확정한다. 모델은 tripId, requestId, BLE 또는 GPS 근거를 만들지 않으며 빈 객체만 전달한다.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
  },
  {
    type: "function",
    name: "get_trip_status",
    description:
      "진행 중인 운행의 최신 상태를 조회한다. 사용자가 현재 정류장, 다음 정류장, 남은 정류장 수, 하차 준비 여부를 물을 때 사용한다. 조회 전용이며 하차벨 요청을 만들지 않는다.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        tripId: {
          type: "string",
          description: "create_trip 성공 응답에서 백엔드가 발급한 운행 식별자.",
        },
      },
      required: ["tripId"],
    },
  },
  {
    type: "function",
    name: "end_trip",
    description:
      "사용자가 운행 안내 종료, 취소, 다른 경로 재탐색을 명확히 요청했을 때 현재 운행을 CANCELLED로 종료한다. 종료 의도가 모호하면 호출하지 말고 먼저 확인한다.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        tripId: {
          type: "string",
          description: "create_trip 성공 응답에서 백엔드가 발급한 운행 식별자.",
        },
        action: {
          type: "string",
          enum: ["CANCEL"],
          description: "운행 종료 동작. 현재 계약에서는 CANCEL만 허용한다.",
        },
      },
      required: ["tripId", "action"],
    },
  },
] as const;

export function createRealtimeSessionUpdateEvent() {
  return {
    type: "session.update",
    session: {
      type: "realtime",
      instructions: HANEUM_REALTIME_INSTRUCTIONS,
      tools: HANEUM_REALTIME_TOOLS,
      tool_choice: "auto",
      audio: {
        input: {
          noise_reduction: {
            type: "near_field",
          },
          turn_detection: {
            type: "semantic_vad",
            eagerness: "low",
            create_response: true,
            // 휴대폰 스피커·주변 소음의 오인식이 진행 중인 음성을 끊지 않게 한다.
            interrupt_response: false,
          },
        },
      },
    },
  } as const;
}

export function createRealtimeReadyResponseEvent() {
  return {
    type: "response.create",
    response: {
      instructions: HANEUM_REALTIME_READY_INSTRUCTIONS,
    },
  } as const;
}
