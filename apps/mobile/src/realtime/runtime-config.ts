import Constants from "expo-constants";

type HaneumExpoExtra = {
  realtimeSharedSecret?: string;
};

export function getRealtimeSharedSecret() {
  const extra = Constants.expoConfig?.extra as HaneumExpoExtra | undefined;
  return extra?.realtimeSharedSecret?.trim();
}
