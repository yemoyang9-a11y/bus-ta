export const TRIP_STATUS = {
  WAITING_BUS: "WAITING_BUS",
  ON_BUS: "ON_BUS",
  NEAR_DESTINATION: "NEAR_DESTINATION",
  TRIP_DONE: "TRIP_DONE",
  ERROR: "ERROR",
} as const;

export type TripStatus = (typeof TRIP_STATUS)[keyof typeof TRIP_STATUS];
