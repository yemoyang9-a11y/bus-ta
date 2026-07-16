import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseBeaconRepository } from "./beacon.repository.js";

const config = { url: "https://example.supabase.co", apiKey: "service-role-key" };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("findByRouteNo maps a bus_beacons row to a Beacon and filters by ACTIVE status", async () => {
  let requestedUrl: string | undefined;
  const repository = new SupabaseBeaconRepository(config, async (input) => {
    requestedUrl = String(input);
    return jsonResponse([
      {
        beacon_id: "BUSTA-1551-DEMO01",
        route_no: "1551",
        local_bus_id: "234001138",
        vehicle_id: null,
        target_beacon_id: "MOCK_BUS_1551_001",
        is_mock: true,
      },
    ]);
  });

  const beacon = await repository.findByRouteNo("1551");

  assert.ok(requestedUrl?.includes("route_no=eq.1551"));
  assert.ok(requestedUrl?.includes("status=eq.ACTIVE"));
  assert.deepEqual(beacon, {
    beaconId: "BUSTA-1551-DEMO01",
    routeNo: "1551",
    localBusId: "234001138",
    targetBeaconId: "MOCK_BUS_1551_001",
    isMock: true,
  });
  assert.ok(!("vehicleId" in (beacon as object)));
});

test("findByRouteNo returns null when no row matches", async () => {
  const repository = new SupabaseBeaconRepository(config, async () => jsonResponse([]));

  const beacon = await repository.findByRouteNo("nonexistent-route");

  assert.equal(beacon, null);
});

test("findByRouteNo throws when Supabase responds with an error status", async () => {
  const repository = new SupabaseBeaconRepository(
    config,
    async () => new Response(null, { status: 500 }),
  );

  await assert.rejects(() => repository.findByRouteNo("1551"));
});

test("findById queries by beacon_id", async () => {
  let requestedUrl: string | undefined;
  const repository = new SupabaseBeaconRepository(config, async (input) => {
    requestedUrl = String(input);
    return jsonResponse([
      {
        beacon_id: "BUSTA-1551-DEMO01",
        route_no: "1551",
        local_bus_id: "234001138",
        vehicle_id: null,
        target_beacon_id: "MOCK_BUS_1551_001",
        is_mock: true,
      },
    ]);
  });

  const beacon = await repository.findById("BUSTA-1551-DEMO01" as never);

  assert.ok(requestedUrl?.includes("beacon_id=eq.BUSTA-1551-DEMO01"));
  assert.equal(beacon?.targetBeaconId, "MOCK_BUS_1551_001");
});

test("findAll returns all rows mapped to Beacon", async () => {
  const repository = new SupabaseBeaconRepository(config, async () =>
    jsonResponse([
      {
        beacon_id: "BUSTA-1551-DEMO01",
        route_no: "1551",
        local_bus_id: "234001138",
        vehicle_id: null,
        target_beacon_id: "MOCK_BUS_1551_001",
        is_mock: true,
      },
      {
        beacon_id: "BUSTA-7002-DEMO01",
        route_no: "7002",
        local_bus_id: null,
        vehicle_id: "001",
        target_beacon_id: "BUS_7002_001",
        is_mock: false,
      },
    ]),
  );

  const beacons = await repository.findAll();

  assert.equal(beacons.length, 2);
  assert.equal(beacons[1]?.isMock, false);
});
