import React, { useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import * as Speech from 'expo-speech';
import { apiClient } from '../api/client';
import { useTrip } from '../state/TripContext';
import { startJourneyBus, toBusLegRoute } from '../state/transfer-journey';

export default function TransferScreen({ navigation }) {
  const { state, dispatch } = useTrip();
  const isFocused = useIsFocused();
  const { journeyRoute, journeyGeneration, journeySegmentIndex: index, journeyPhase, tripId } = state;
  const segment = index === null ? null : journeyRoute?.segments?.[index];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const startingRef = useRef(false);
  const latestRef = useRef(state);
  latestRef.current = state;

  useEffect(() => {
    if (!isFocused) return;
    if (!journeyRoute) navigation.navigate('Main');
    else if (segment?.mode === 'BUS' && tripId && journeyPhase === 'GUIDING') {
      navigation.navigate('Riding', { tripId, selectedRoute: state.selectedRoute });
    }
  }, [journeyRoute, index, journeyPhase, tripId, state.selectedRoute, navigation, isFocused]);

  useEffect(() => {
    if (!isFocused || !segment || journeyPhase === 'BUS_ALIGHT_CONFIRM' || (segment.mode === 'BUS' && tripId)) return;
    const text = segment.mode === 'WALK'
      ? `${segment.endName}까지 도보로 이동한 뒤 도착을 확인해 주세요.`
      : segment.mode === 'SUBWAY'
        ? journeyPhase === 'SUBWAY_ON_BOARD'
          ? `${segment.endName}에서 내린 뒤 하차를 확인해 주세요.`
          : `${segment.lineNames.join(' 또는 ')} 지하철을 타고 탑승을 확인해 주세요.`
        : `${segment.startName}에서 ${segment.busLeg?.routeNo ?? ''}번 버스 안내를 시작해 주세요.`;
    Speech.speak(text, { language: 'ko' });
  }, [journeyRoute, index, journeyPhase, tripId, isFocused]);

  if (!journeyRoute || !segment || index === null) return null;

  const final = index === journeyRoute.segments.length - 1;
  const title = segment.mode === 'WALK' ? '도보 이동' : segment.mode === 'SUBWAY' ? '지하철 이동' : '버스 환승';
  const instruction = segment.mode === 'WALK'
    ? `${segment.endName}까지 도보로 이동한 뒤 도착을 확인해 주세요.`
    : segment.mode === 'SUBWAY'
      ? journeyPhase === 'SUBWAY_ON_BOARD'
        ? `${segment.endName}에서 내린 뒤 하차를 확인해 주세요.`
        : `${segment.lineNames.join(' 또는 ')} 지하철을 타고 탑승을 확인해 주세요.`
      : journeyPhase === 'BUS_ALIGHT_CONFIRM'
        ? `${segment.endName}에서 실제로 내린 뒤 하차를 확인해 주세요.`
        : `${segment.startName}에서 ${segment.busLeg?.routeNo ?? ''}번 버스 운행을 시작해 주세요.`;
  const buttonLabel = segment.mode === 'WALK' ? '도착했어요'
    : segment.mode === 'SUBWAY' ? journeyPhase === 'SUBWAY_ON_BOARD' ? '내렸어요' : '탔어요'
      : journeyPhase === 'BUS_ALIGHT_CONFIRM' ? '내렸어요' : '버스 안내 시작';

  const confirm = () => {
    if (busy) return;
    dispatch({ type: 'CONFIRM_JOURNEY_STEP', expectedIndex: index, expectedPhase: journeyPhase });
    if (final && (segment.mode !== 'SUBWAY' || journeyPhase === 'SUBWAY_ON_BOARD')) {
      Speech.speak('목적지에 도착했습니다. 안내를 마칩니다.', { language: 'ko' });
    }
  };

  const startBus = async () => {
    if (startingRef.current || tripId || journeyPhase !== 'GUIDING') return;
    startingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const busRoute = toBusLegRoute(journeyRoute, index);
      const created = await startJourneyBus(journeyRoute, index, journeyGeneration, apiClient.trips.create);
      const latest = latestRef.current;
      if (latest.tripId === created.tripId && latest.journeyGeneration === journeyGeneration) return;
      if (latest.journeyRoute !== journeyRoute || latest.journeyGeneration !== journeyGeneration ||
        latest.journeySegmentIndex !== index || latest.journeyPhase !== 'GUIDING' || latest.tripId) {
        if (latest.tripId !== created.tripId) await apiClient.trips.end(created.tripId, { action: 'CANCEL' }).catch(() => undefined);
        return;
      }
      dispatch({ type: 'SELECT_ROUTE', route: busRoute });
      dispatch({ type: 'START_TRIP', tripId: created.tripId });
      navigation.navigate('Riding', { tripId: created.tripId, selectedRoute: busRoute });
    } catch {
      setError('버스 운행을 시작하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.');
    } finally {
      startingRef.current = false;
      setBusy(false);
    }
  };

  const cancelJourney = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (tripId && state.tripStatus !== 'TRIP_DONE' && state.tripStatus !== 'CANCELLED') {
        await apiClient.trips.end(tripId, { action: 'CANCEL' });
      }
      dispatch({ type: 'RESET_TRIP_KEEP_SEARCH' });
      navigation.navigate('Main');
    } catch {
      setError('안내 종료를 확인하지 못했습니다. 다시 시도해 주세요.');
    } finally { setBusy(false); }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.progress}>{index + 1} / {journeyRoute.segments.length} 구간</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.path}>{segment.startName} → {segment.endName}</Text>
      <Text style={styles.instruction}>{instruction}</Text>
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {busy ? <ActivityIndicator size="large" color="#FFD400" /> : (
        <TouchableOpacity style={styles.button} accessibilityRole="button"
          accessibilityLabel={buttonLabel} onPress={segment.mode === 'BUS' && journeyPhase === 'GUIDING' ? startBus : confirm}>
          <Text style={styles.buttonText}>{buttonLabel}</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="환승 안내 종료" onPress={cancelJourney} disabled={busy}
        style={styles.cancelButton}><Text style={styles.cancelText}>환승 안내 종료</Text></TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0C10', padding: 24, justifyContent: 'center' },
  progress: { color: '#2F8FFF', fontSize: 20, fontWeight: '700', marginBottom: 12 },
  title: { color: '#FFD400', fontSize: 32, fontWeight: '800', marginBottom: 24 },
  path: { color: '#FFFFFF', fontSize: 24, fontWeight: '700', marginBottom: 24 },
  instruction: { color: '#FFFFFF', fontSize: 20, lineHeight: 30, marginBottom: 32 },
  button: { backgroundColor: '#FFC400', minHeight: 76, borderRadius: 18, borderWidth: 3, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#111111', fontSize: 22, fontWeight: '800' },
  error: { color: '#FF6B6B', fontSize: 17, marginBottom: 16 },
  cancelButton: { padding: 18, alignItems: 'center', marginTop: 24 },
  cancelText: { color: '#B8BFC9', fontSize: 17, fontWeight: '700' },
});
