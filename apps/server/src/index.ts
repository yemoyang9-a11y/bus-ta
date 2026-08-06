import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import express from "express";
import { healthRouter } from "./routes/health.js";
import { routesRouter } from "./routes/routes.js";
import { tripsRouter } from "./routes/trips.js";
import { beaconsRouter } from "./routes/beacons.js";
import { realtimeRouter } from "./routes/realtime.js";

// 실행 디렉터리부터 상위 디렉터리까지 .env 를 자동 로드한다 (있을 때만).
// pnpm --filter 실행 시 cwd 가 apps/server 로 잡혀도 루트 .env 를 함께 읽기 위함이다.
loadEnvFiles(process.cwd());

const app = express();
app.use(express.json());

app.use("/api/health", healthRouter);
app.use("/api/routes", routesRouter);
app.use("/api/trips", tripsRouter);
app.use("/api/beacons", beaconsRouter);
app.use("/api/realtime", realtimeRouter);

const port = process.env["PORT"] ?? 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

export default app;

function loadEnvFiles(startDir: string) {
  const envFilePaths: string[] = [];
  let currentDir = resolve(startDir);

  while (true) {
    const envFilePath = resolve(currentDir, ".env");
    if (existsSync(envFilePath)) {
      envFilePaths.push(envFilePath);
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  for (const envFilePath of envFilePaths.reverse()) {
    process.loadEnvFile(envFilePath);
  }
}
