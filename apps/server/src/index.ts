import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import { healthRouter } from "./routes/health.js";
import { routesRouter } from "./routes/routes.js";
import { tripsRouter } from "./routes/trips.js";
import { beaconsRouter } from "./routes/beacons.js";
import { realtimeRouter } from "./routes/realtime.js";
import { API_PATHS } from "@bus-ta/shared";

// 실행 디렉터리의 .env 를 자동 로드한다 (있을 때만).
// 이미 셸에서 주입한 환경변수가 우선하며, .env 가 없어도 서버는 정상 기동한다.
const envFilePath = resolve(process.cwd(), ".env");
if (existsSync(envFilePath)) {
  process.loadEnvFile(envFilePath);
}

const app = express();
app.use(express.json());

app.use("/api/health", healthRouter);
app.use("/api/routes", routesRouter);
app.use("/api/trips", tripsRouter);
app.use("/api/beacons", beaconsRouter);
app.use(API_PATHS.realtime.session, realtimeRouter);

const port = process.env["PORT"] ?? 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

export default app;
