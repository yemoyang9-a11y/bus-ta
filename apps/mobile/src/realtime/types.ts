import type {
  CreateTripRequest,
  RealtimeSessionResponse,
  Route,
  TripStatusResponse,
} from "@bus-ta/shared";

export type RealtimeFunctionName =
  | "search_routes"
  | "create_trip"
  | "get_trip_status"
  | "end_trip";

export type RealtimeFunctionCallEvent = {
  type: "response.function_call_arguments.done";
  call_id: string;
  name: RealtimeFunctionName;
  arguments: string;
};

export type RealtimeTransport = {
  send(event: unknown): void;
};

export type RealtimeGuideContext = {
  destination?: string;
  routes: Route[];
  selectedRoute?: CreateTripRequest;
  tripId?: string;
  tripStatus?: TripStatusResponse["tripStatus"];
  lastFunctionResult?: unknown;
};

export type RealtimeClientEvent =
  | {
      type: "conversation.item.create";
      item: {
        type: "function_call_output";
        call_id: string;
        output: string;
      };
    }
  | {
      type: "response.create";
      response?: {
        instructions?: string;
      };
    };

export type ApiErrorResult = {
  success: false;
  errorCode: string;
  message: string;
  timestamp: string;
};

export type CreateRealtimeSessionResponse = RealtimeSessionResponse;
