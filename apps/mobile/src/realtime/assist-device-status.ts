import type {
  AssistDeviceStatusChangedEvent,
} from "./types";

export const ASSIST_DEVICE_RESPONSE_INSTRUCTIONS =
  "방금 전달된 보조기기 상태 이벤트만 근거로 사용자에게 짧고 명확한 한국어 음성 안내를 생성한다. attempted가 false이면 실제 BLE 연결을 시도하기 전 단계에서 실패한 것이므로 지팡이나 하차벨의 전원·연결을 탓하거나 확인하라고 말하지 않는다. reason이 BEACON_NOT_REGISTERED이면 이 노선의 비콘 정보가 등록되지 않아 버스 접근 진동을 준비하지 못했다고 말한다. reason이 BEACON_LOOKUP_FAILED이면 현재 비콘 정보를 확인하지 못해 버스 접근 진동을 준비하지 못했다고 말한다. 이 두 오류는 하차벨 BLE 연결 실패를 뜻하지 않으므로 하차벨도 작동하지 않는다고 말하지 않는다. device가 CANE이면 버스 접근 진동 안내를 사용할 수 없다고, device가 BELL이면 하차벨이 작동하지 않을 수 있으니 내리기 전에 기사님께 직접 말씀해 달라고 안내한다. device가 BOTH이면 두 내용을 모두 짧게 안내한다. retryable이 false이면 다시 시도하겠다고 약속하거나 반복 시도를 권하지 않는다. 내부 필드명과 오류 코드는 읽지 않는다.";

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
    return "현재 비콘 정보를 확인하지 못해 버스 접근 진동을 준비하지 못했습니다.";
  }

  if (event.device === "BOTH") {
    return "지팡이와 하차벨에 연결하지 못했습니다. 버스 접근 진동을 사용할 수 없고, 내리기 전에 기사님께 직접 말씀해 주세요.";
  }

  if (event.device === "BELL") {
    return "하차벨에 연결하지 못했습니다. 내리기 전에 기사님께 직접 말씀해 주세요.";
  }

  if (event.reason === "COMMAND_FAILED") {
    return "지팡이 명령 전송에 실패해 버스 접근 진동을 사용할 수 없습니다.";
  }

  return "지팡이에 연결하지 못해 버스 접근 진동을 사용할 수 없습니다.";
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
