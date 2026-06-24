import express from "express";
import { healthRouter } from "./routes/health.js";
import { routesRouter } from "./routes/routes.js";
import { tripsRouter } from "./routes/trips.js";
import { beaconsRouter } from "./routes/beacons.js";

const app = express();
app.use(express.json());

app.use("/api/health", healthRouter);
app.use("/api/routes", routesRouter);
app.use("/api/trips", tripsRouter);
app.use("/api/beacons", beaconsRouter);

const port = process.env["PORT"] ?? 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

export default app;
