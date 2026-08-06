import appJson from "./app.json";
import type { ConfigContext, ExpoConfig } from "expo/config";

declare const process: {
  env: {
    REALTIME_SHARED_SECRET?: string;
  };
};

const expoConfig = appJson.expo as ExpoConfig & {
  extra?: Record<string, unknown>;
};

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  ...expoConfig,
  extra: {
    ...(expoConfig.extra ?? {}),
    realtimeSharedSecret: process.env["REALTIME_SHARED_SECRET"],
  },
});
