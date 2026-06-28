const { searchRoutes } = require("./routeSearch");

async function test() {
  console.log("=== candidates → summary 변환 테스트 ===");
  const result = await searchRoutes("병점역", 37.213789, 126.979749);

  const summary = result.candidates.map(({ stationList, ...rest }) => ({
    candidateId: rest.candidateId,
    routeNo: rest.routeNo,
    totalTime: rest.totalTime,
    totalWalk: rest.totalWalk,
    payment: rest.payment,
    intervalTime: rest.intervalTime,
    busStationCount: rest.busStationCount,
    boardingStation: { stationName: rest.boardingStation.stationName },
    destinationStation: { stationName: rest.destinationStation.stationName },
  }));

  console.log("후보 수:", result.candidates.length);
  console.log("\n유나에게 넘길 summary:");
  console.log(JSON.stringify(summary, null, 2));
}

test().catch(console.error);
