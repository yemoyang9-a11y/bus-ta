import { Router } from "express";
import { FixtureBeaconRepository } from "../repositories/beacon.repository.js";
import { getBeaconByRoute } from "../services/beacon/get-beacon.service.js";

export const beaconsRouter = Router();

// 중간평가 MVP: 비콘은 fixture 단일 출처에서 조회한다.
const beaconRepository = new FixtureBeaconRepository();

// GET /api/beacons?routeNo=
beaconsRouter.get("/", async (req, res) => {
  const result = await getBeaconByRoute(req.query["routeNo"], beaconRepository);
  res.status(result.httpStatus).json(result.body);
});
