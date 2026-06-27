import { readSupabaseConfig, type SupabaseConfig } from "../../config/supabase.js";
import type {
  CreateTripWithStatusInput,
  TripCreationRepository,
  TripCreateRecord,
  TripStatusCreateRecord,
} from "../../services/trip/create-trip.service.js";
import type {
  LocationLogLookup,
  SaveStatusAndLocationInput,
  TripProgressData,
  UpdateTripStatusRepository,
} from "../../services/trip/update-trip-status.service.js";

type Env = Partial<Record<string, string | undefined>>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function createSupabaseTripRepositoryFromEnv(
  env: Env = process.env,
  fetchImpl: FetchLike = fetch,
): SupabaseTripRepository | null {
  const config = readSupabaseConfig(env);
  return config ? new SupabaseTripRepository(config, fetchImpl) : null;
}

export class SupabaseTripRepository implements TripCreationRepository, UpdateTripStatusRepository {
  constructor(
    private readonly config: SupabaseConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async createTripWithStatus(data: CreateTripWithStatusInput): Promise<void> {
    await this.insert("trips", toTripRow(data.trip));

    try {
      await this.insert("trip_status", toTripStatusRow(data.status));
    } catch (error) {
      await this.deleteTrip(data.trip.tripId);
      throw error;
    }
  }

  async findTripProgressData(tripId: string): Promise<TripProgressData | null> {
    const tripRows = await this.selectRows("trips", `trip_id=eq.${encodeURIComponent(tripId)}`);
    const statusRows = await this.selectRows("trip_status", `trip_id=eq.${encodeURIComponent(tripId)}`);
    const trip = tripRows[0];
    const status = statusRows[0];

    if (!trip || !status) {
      return null;
    }

    return {
      trip: {
        tripId: readString(trip, "trip_id"),
        destination: readString(trip, "destination"),
        routeNo: readString(trip, "route_no"),
        stationList: readArray(trip, "station_list"),
      },
      status: {
        tripId: readString(status, "trip_id"),
        currentStation: readNullableObject(status, "current_station"),
        nextStation: readNullableObject(status, "next_station"),
        remainingStations: readNumber(status, "remaining_stations"),
        tripStatus: readString(status, "trip_status"),
        bellStatus: readString(status, "bell_status"),
        bellRequestId: null,
        command: null,
        lastRequestId: readNullableString(status, "last_request_id"),
        locationSource: readNullableString(status, "location_source"),
        recordedAt: readNullableString(status, "recorded_at"),
        updatedAt: readString(status, "updated_at"),
      },
    };
  }

  async findLocationLogByRequestId(tripId: string, requestId: string): Promise<LocationLogLookup | null> {
    const rows = await this.selectRows(
      "location_logs",
      `trip_id=eq.${encodeURIComponent(tripId)}&request_id=eq.${encodeURIComponent(requestId)}`,
    );
    const row = rows[0];

    if (!row) {
      return null;
    }

    return {
      tripId: readString(row, "trip_id"),
      requestId: readString(row, "request_id"),
    };
  }

  async saveStatusAndLocation(data: SaveStatusAndLocationInput): Promise<void> {
    await this.patch(
      "trip_status",
      `trip_id=eq.${encodeURIComponent(data.status.tripId)}`,
      toTripStatusUpdateRow(data.status),
    );
    await this.insert("location_logs", toLocationLogRow(data.locationLog));
  }

  private async insert(table: string, row: Record<string, unknown>) {
    const response = await this.fetchImpl(`${this.config.url}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        ...this.headers(),
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    });

    if (!response.ok) {
      throw new Error(`Supabase insert failed for ${table}: ${response.status}`);
    }
  }

  private async patch(table: string, query: string, row: Record<string, unknown>) {
    const response = await this.fetchImpl(`${this.config.url}/rest/v1/${table}?${query}`, {
      method: "PATCH",
      headers: {
        ...this.headers(),
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    });

    if (!response.ok) {
      throw new Error(`Supabase update failed for ${table}: ${response.status}`);
    }
  }

  private async selectRows(table: string, query: string): Promise<Record<string, unknown>[]> {
    const response = await this.fetchImpl(`${this.config.url}/rest/v1/${table}?select=*&${query}`, {
      method: "GET",
      headers: this.headers(),
    });

    if (!response.ok) {
      throw new Error(`Supabase select failed for ${table}: ${response.status}`);
    }

    const body = (await response.json()) as unknown;
    return Array.isArray(body) ? (body as Record<string, unknown>[]) : [];
  }

  private async deleteTrip(tripId: string) {
    await this.fetchImpl(`${this.config.url}/rest/v1/trips?trip_id=eq.${encodeURIComponent(tripId)}`, {
      method: "DELETE",
      headers: {
        ...this.headers(),
        Prefer: "return=minimal",
      },
    });
  }

  private headers() {
    return {
      apikey: this.config.apiKey,
      Authorization: `Bearer ${this.config.apiKey}`,
      "Content-Type": "application/json",
    };
  }
}

function toTripRow(trip: TripCreateRecord) {
  return {
    trip_id: trip.tripId,
    user_id: null,
    destination: trip.destination,
    candidate_id: trip.candidateId,
    route_no: trip.routeNo,
    local_bus_id: trip.localBusId,
    gbis_station_id: trip.gbisStationId,
    vehicle_id: trip.vehicleId,
    boarding_station: trip.boardingStation,
    destination_station: trip.destinationStation,
    station_list: trip.stationList,
    total_time: trip.totalTime,
    total_walk: trip.totalWalk,
    payment: trip.payment,
    bus_transit_count: trip.busTransitCount,
    bus_station_count: trip.busStationCount,
    total_distance: trip.totalDistance,
    interval_time: trip.intervalTime,
    predicted_arrival_minutes: trip.predictedArrivalMinutes,
    created_at: trip.createdAt,
    updated_at: trip.updatedAt,
  };
}

function toTripStatusRow(status: TripStatusCreateRecord) {
  return {
    trip_id: status.tripId,
    current_station: status.currentStation,
    next_station: status.nextStation,
    remaining_stations: status.remainingStations,
    trip_status: status.tripStatus,
    bell_status: status.bellStatus,
    last_request_id: status.lastRequestId,
    location_source: status.locationSource,
    recorded_at: status.recordedAt,
    updated_at: status.updatedAt,
  };
}

function toTripStatusUpdateRow(status: SaveStatusAndLocationInput["status"]) {
  return {
    current_station: status.currentStation,
    next_station: status.nextStation,
    remaining_stations: status.remainingStations,
    trip_status: status.tripStatus,
    bell_status: status.bellStatus,
    last_request_id: status.lastRequestId,
    location_source: status.locationSource,
    recorded_at: status.recordedAt,
    updated_at: status.updatedAt,
  };
}

function toLocationLogRow(locationLog: SaveStatusAndLocationInput["locationLog"]) {
  return {
    trip_id: locationLog.tripId,
    request_id: locationLog.requestId,
    latitude: locationLog.latitude,
    longitude: locationLog.longitude,
    source: locationLog.source,
    recorded_at: locationLog.recordedAt,
    current_station: locationLog.currentStation,
    remaining_stations: locationLog.remainingStations,
    location_accepted: locationLog.locationAccepted,
    reason: locationLog.reason,
  };
}

function readString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (typeof value !== "string") {
    throw new Error(`Expected ${key} to be a string`);
  }
  return value;
}

function readNullableString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error(`Expected ${key} to be a nullable string`);
  }
  return value;
}

function readNumber(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (typeof value !== "number") {
    throw new Error(`Expected ${key} to be a number`);
  }
  return value;
}

function readArray(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (!Array.isArray(value)) {
    throw new Error(`Expected ${key} to be an array`);
  }
  return value as TripProgressData["trip"]["stationList"];
}

function readNullableObject(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected ${key} to be a nullable object`);
  }
  return value as TripProgressData["status"]["currentStation"];
}
