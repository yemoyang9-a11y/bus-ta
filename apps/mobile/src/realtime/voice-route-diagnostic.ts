declare const __DEV__: boolean;

type Stage = 'policy_sent' | 'policy_ack' | 'function_received' | 'function_result' |
  'end_api_result' | 'duplicate_end' | 'reset_requested' | 'screen_ready' | 'screen_timeout' | 'handler_failed';
type Fields = { tool?: unknown; phase?: unknown; success?: boolean; hasTrip?: boolean;
  missedBus?: boolean; cancelRequested?: boolean; refreshArrivals?: boolean; policy?: unknown; screen?: unknown };
const tools = ['search_routes', 'create_trip', 'get_next_route_candidates', 'start_journey',
  'confirm_journey_step', 'start_journey_bus', 'cancel_journey', 'confirm_boarding', 'get_trip_status', 'end_trip'];

// Explicit allowlist: never log arguments, utterances, IDs, coordinates or errors.
export function createVoiceRouteDiagnostic(stage: Stage, fields: Fields = {}) {
  const record: Record<string, string | boolean | null> = { stage };
  if (typeof fields.tool === 'string' && tools.includes(fields.tool)) record.tool = fields.tool;
  if (fields.phase === null || ['WAITING_BUS', 'ON_BUS', 'NEAR_DESTINATION', 'TRIP_DONE', 'CANCELLED'].includes(String(fields.phase))) {
    record.phase = fields.phase as string | null;
  }
  for (const key of ['success', 'hasTrip', 'missedBus', 'cancelRequested', 'refreshArrivals'] as const) {
    if (typeof fields[key] === 'boolean') record[key] = fields[key];
  }
  if (['sent', 'confirmed', 'different', 'unavailable'].includes(String(fields.policy))) record.policy = String(fields.policy);
  if (fields.screen === 'RouteList' || fields.screen === 'Main') record.screen = fields.screen;
  return record;
}
export function logVoiceRouteDiagnostic(stage: Stage, fields: Fields = {}) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.info('[VoiceRoute]', createVoiceRouteDiagnostic(stage, fields));
}
