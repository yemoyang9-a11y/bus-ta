import { apiClient, ApiError } from '../api/client';

// 진행 중인 호출을 추적 — 동일 함수+인자 조합의 병렬 재호출 방지
const inFlightCalls = new Map();

// create_trip은 노선 선택당 1회만 — tripId가 이미 있으면 재호출 자체를 막는다
function buildCallKey(functionName, args) {
  return `${functionName}:${JSON.stringify(args)}`;
}

/**
 * function_call 이벤트를 받아 실제 REST API로 변환·실행한다.
 *
 * @param {string} functionName - search_routes | create_trip | get_trip_status | end_trip
 * @param {object} modelArgs - 모델이 준 인자 (신뢰하지 않음, 검증 후 필요한 값만 사용)
 * @param {object} tripState - Phase 3의 TripContext state (실제 앱 상태값의 출처)
 * @param {object} currentLocation - 호출부(화면)가 미리 받아온 실제 GPS 좌표 { latitude, longitude }
 *   좌표는 모델이 지어낼 수 있는 값이라 modelArgs로 받지 않고, 반드시 이 파라미터로만 전달한다.
 * @returns {Promise<object>} 세션에 되돌려줄 결과
 */
export async function dispatchFunctionCall(functionName, modelArgs, tripState, currentLocation) {
  const callKey = buildCallKey(functionName, modelArgs);

  // 동일 인자로 이미 처리 중이면, 그 Promise를 그대로 재사용 (중복 호출 방지)
  if (inFlightCalls.has(callKey)) {
    return inFlightCalls.get(callKey);
  }

  const callPromise = executeFunctionCall(functionName, modelArgs, tripState, currentLocation).finally(() => {
    inFlightCalls.delete(callKey);
  });

  inFlightCalls.set(callKey, callPromise);
  return callPromise;
}

async function executeFunctionCall(functionName, modelArgs, tripState, currentLocation) {
  try {
    switch (functionName) {
      case 'search_routes':
        return await handleSearchRoutes(modelArgs, currentLocation);

      case 'create_trip':
        return await handleCreateTrip(modelArgs, tripState);

      case 'get_trip_status':
        return await handleGetTripStatus(tripState);

      case 'end_trip':
        return await handleEndTrip(tripState);

      default:
        return {
          success: false,
          errorCode: 'UNKNOWN_FUNCTION',
          message: `알 수 없는 function: ${functionName}`,
        };
    }
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        success: false,
        errorCode: error.errorCode,
        message: error.message,
      };
    }
    return {
      success: false,
      errorCode: 'DISPATCHER_UNKNOWN_ERROR',
      message: error?.message ?? '알 수 없는 오류가 발생했습니다.',
    };
  }
}

// ── 개별 함수 핸들러 ──────────────────────────────

async function handleSearchRoutes(modelArgs, currentLocation) {
  // destination은 모델이 사용자 발화에서 추출한 값이라 신뢰 가능 (모델의 정당한 역할)
  // latitude/longitude는 모델이 지어낼 수 있으므로 modelArgs에서 받지 않고,
  // 호출부가 실제 GPS로 받아온 currentLocation만 사용한다.
  const { destination } = modelArgs;

  if (!currentLocation?.latitude || !currentLocation?.longitude) {
    return {
      success: false,
      errorCode: 'LOCATION_UNAVAILABLE',
      message: '현재 위치를 확인할 수 없습니다.',
    };
  }

  const data = await apiClient.routes.search({
    destination,
    latitude: currentLocation.latitude,
    longitude: currentLocation.longitude,
  });
  return { success: true, routes: data.routes };
}

async function handleCreateTrip(modelArgs, tripState) {
  // create_trip은 선택당 1회만 — 이미 tripId가 있으면 새로 만들지 않는다
  if (tripState.tripId) {
    return {
      success: false,
      errorCode: 'TRIP_ALREADY_STARTED',
      message: '이미 진행 중인 운행이 있습니다.',
    };
  }

  // tripId, 좌표 등은 모델이 지어낼 수 있는 값이라 여기서 받지 않는다.
  // 실제로 보낼 필드는 앱 상태(tripState.selectedRoute)에서 가져온다.
  const selectedRoute = tripState.selectedRoute;
  if (!selectedRoute) {
    return {
      success: false,
      errorCode: 'NO_ROUTE_SELECTED',
      message: '선택된 노선이 없습니다. 먼저 노선을 선택해주세요.',
    };
  }

  const tripRequest = {
    destination: tripState.destination || selectedRoute.destinationStation?.stationName,
    candidateId: selectedRoute.candidateId,
    routeNo: selectedRoute.routeNo,
    localBusId: selectedRoute.localBusId,
    gbisStationId: selectedRoute.gbisStationId,
    boardingStation: selectedRoute.boardingStation,
    destinationStation: selectedRoute.destinationStation,
    stationList: selectedRoute.stationList,
    totalTime: selectedRoute.totalTime,
    totalWalk: selectedRoute.totalWalk,
    payment: selectedRoute.payment,
    busTransitCount: selectedRoute.busTransitCount,
    busStationCount: selectedRoute.busStationCount,
    totalDistance: selectedRoute.totalDistance,
    intervalTime: selectedRoute.intervalTime,
  };

  const data = await apiClient.trips.create(tripRequest);
  return { success: true, tripId: data.tripId };
}

async function handleGetTripStatus(tripState) {
  // tripId는 모델이 지어낼 수 있으므로 절대 modelArgs에서 받지 않고 앱 상태에서만 가져온다
  if (!tripState.tripId) {
    return {
      success: false,
      errorCode: 'NO_ACTIVE_TRIP',
      message: '진행 중인 운행이 없습니다.',
    };
  }

  const data = await apiClient.trips.getStatus(tripState.tripId);
  return { success: true, status: data };
}

async function handleEndTrip(tripState) {
  if (!tripState.tripId) {
    return {
      success: false,
      errorCode: 'NO_ACTIVE_TRIP',
      message: '진행 중인 운행이 없습니다.',
    };
  }

  // 예모님 확인(2026-08-04): PATCH /api/trips/{tripId}, body는 { action: 'CANCEL' } 고정
  // tripId는 Path에만, body에 중복 전달하지 않는다
  // client.ts의 trips.end(tripId, body) 구조로 변경됨 (merge 반영, 2026-08-12)
  const data = await apiClient.trips.end(tripState.tripId, { action: 'CANCEL' });
  return { success: true, status: data };
}