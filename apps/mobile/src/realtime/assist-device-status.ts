import type {
  AssistDeviceStatusChangedEvent,
} from "./types";

export const ASSIST_DEVICE_RESPONSE_INSTRUCTIONS =
  "앱이 실패 원인과 실제 연결 시도 여부, 재시도 가능 여부로 확정한 아래 안내 문구만 그대로 읽는다. 설명, 질문, 전문가 문의, 전원·블루투스 점검 권유를 덧붙이지 않는다. 재시도 가능은 재시도 중이라는 뜻이 아니므로 실행을 약속하지 않는다. 다른 Function을 호출하거나 내부 필드명과 오류 코드를 읽지 않는다.";

export function getAssistDeviceResponseInstructions(
  event: AssistDeviceStatusChangedEvent,
) {
  return `${ASSIST_DEVICE_RESPONSE_INSTRUCTIONS}\n안내 문구: ${getAssistDeviceFallbackMessage(event)}`;
}

export function createAssistDeviceStatusEvent(
  event: Omit<
    AssistDeviceStatusChangedEvent,
    "type" | "status"
  >,
): AssistDeviceStatusChangedEvent {
  return {
    type: "assist_device_status_changed",
    status: "UNAVAILABLE",
    ...event,
  };
}

export function createAssistDeviceConnectionFailureEvents(
  caneConnected: boolean,
  bellConnected: boolean,
): AssistDeviceStatusChangedEvent[] {
  if (caneConnected && bellConnected) {
    return [];
  }

  if (!caneConnected && !bellConnected) {
    return [
      createAssistDeviceStatusEvent({
        device: "BOTH",
        reason: "NOT_CONNECTED",
        attempted: true,
        retryable: true,
      }),
    ];
  }

  return [
    createAssistDeviceStatusEvent({
      device: caneConnected ? "BELL" : "CANE",
      reason: "NOT_CONNECTED",
      attempted: true,
      retryable: true,
    }),
  ];
}

export function createBeaconLookupFailureEvent(
  errorCode?: string,
): AssistDeviceStatusChangedEvent {
  const isNotRegistered =
    errorCode === "BEACON_NOT_FOUND";

  return createAssistDeviceStatusEvent({
    device: "CANE",
    reason: isNotRegistered
      ? "BEACON_NOT_REGISTERED"
      : "BEACON_LOOKUP_FAILED",
    attempted: false,
    retryable: !isNotRegistered,
  });
}

export function getAssistDeviceFallbackMessage(
  event: AssistDeviceStatusChangedEvent,
) {
  if (
    event.reason === "BEACON_NOT_REGISTERED"
  ) {
    return "이 노선의 비콘 정보가 등록되지 않아 버스 접근 진동을 준비하지 못했습니다.";
  }

  if (
    event.reason === "BEACON_LOOKUP_FAILED"
  ) {
    return event.retryable
      ? "비콘 정보를 불러오지 못했습니다. 다시 조회할 수 있습니다."
      : "비콘 정보를 확인하지 못해 버스 접근 진동 안내를 준비하지 못했습니다.";
  }

  const deviceName = event.device === "BOTH"
    ? "지팡이와 하차벨"
    : event.device === "BELL" ? "하차벨" : "지팡이";
  const failure = event.reason === "COMMAND_FAILED"
    ? `${deviceName}에 명령을 전달하지 못했습니다.`
    : event.attempted
      ? `${deviceName}에 연결하지 못했습니다.`
      : `${deviceName} 연결을 준비하지 못했습니다.`;

  if (event.retryable) {
    const retry = event.reason === "COMMAND_FAILED"
      ? "명령을 다시 전송할 수 있습니다."
      : event.attempted ? "다시 연결을 시도할 수 있습니다." : "다시 준비를 시도할 수 있습니다.";
    const bellSafety = event.device === "CANE"
      ? "" : " 내리기 전에 기사님께 직접 말씀해 주세요.";
    return `${failure} ${retry}${bellSafety}`;
  }

  if (event.device === "BOTH") {
    return `${failure} 버스 접근 진동 안내를 사용할 수 없습니다. 내리기 전에 기사님께 직접 말씀해 주세요.`;
  }

  if (event.device === "BELL") {
    return `${failure} 내리기 전에 기사님께 직접 말씀해 주세요.`;
  }

  return `${failure} 버스 접근 진동 안내를 사용할 수 없습니다.`;
}

export function getAssistDeviceEventKey(
  tripId: string | null,
  event: AssistDeviceStatusChangedEvent,
) {
  return [
    tripId ?? "no-trip",
    event.device,
    event.status,
    event.reason,
    event.attempted,
    event.retryable,
  ].join(":");
}
