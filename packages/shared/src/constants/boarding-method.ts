export const BOARDING_METHOD = {
  USER_CONFIRMED: "USER_CONFIRMED",
  AUTO_DETECTED: "AUTO_DETECTED",
} as const;

export type BoardingMethod = (typeof BOARDING_METHOD)[keyof typeof BOARDING_METHOD];
