const { searchRoutes, getArrivalInfo } = require("./routeSearch");

async function test() {
  console.log("=== 1단계: searchRoutes() 테스트 ===");
  const result = await searchRoutes("병점역", 37.213789, 126.979749);
  console.log(JSON.stringify(result, null, 2));

  if (!result.candidates || result.candidates.length === 0) {
    console.log("후보 없음");
    return;
  }

  console.log("\n=== 2단계: getArrivalInfo() 테스트 (첫 번째 후보 선택) ===");
  const selected = result.candidates[0];
  console.log("선택 후보:", selected.routeNo, "/ gbisStationId:", selected.gbisStationId, "/ localBusId:", selected.localBusId);

  const arrival = await getArrivalInfo(selected);
  console.log(JSON.stringify(arrival, null, 2));
}

test().catch(console.error);
