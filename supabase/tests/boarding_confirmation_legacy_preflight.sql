insert into public.trips (
  trip_id,
  destination,
  candidate_id,
  route_no,
  local_bus_id,
  gbis_station_id,
  boarding_station,
  destination_station,
  station_list
)
values (
  'trip-legacy-active-test',
  '수원대학교',
  1,
  '700-2',
  'local-bus-test',
  'station-test',
  '{"stationName":"승차 정류장"}'::jsonb,
  '{"stationName":"하차 정류장"}'::jsonb,
  '[{"stationName":"승차 정류장"},{"stationName":"하차 정류장"}]'::jsonb
);

insert into public.trip_status (
  trip_id,
  remaining_stations,
  trip_status,
  bell_status
)
values (
  'trip-legacy-active-test',
  2,
  'ON_BUS',
  'NOT_REQUESTED'
);
