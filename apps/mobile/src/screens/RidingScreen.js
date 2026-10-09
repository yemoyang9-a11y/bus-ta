import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import * as NativeSpeech from 'expo-speech';
import { getSafeSpeech } from '../realtime/safe-speech';
import VoiceRecoveryControl from '../realtime/VoiceRecoveryControl';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useTrip } from '../state/TripContext';
import { isScreenTripActive } from '../state/trip-transition';
import { TRIP_COMPLETION_MESSAGE } from '../realtime/trip-tracking';
import { createOneStopAlightGuide, ONE_STOP_GUIDE_MESSAGE } from '../realtime/one-stop-alight-guide';
const Speech = getSafeSpeech(NativeSpeech);
import { useRealtime } from '../realtime/RealtimeProvider';
import {
  connectBell,
  disconnectBellsForTrip,
  startBeaconScan,
  stopBeaconScan,
} from '../ble/bleManager';
import { createAssistDeviceStatusEvent } from '../realtime/assist-device-status';
import { canStartBeaconScan } from '../ble/beacon-scan-gate';
import {
  startBeaconScanWithRetry,
  stopBeaconScanWithRetry,
} from '../ble/beacon-scan-controller';
import { connectBellWithRetry } from '../ble/bell-connect-controller';

const INITIAL_STATUS = {
  currentStation: null,
  nextStation: null,
  remainingStations: null,
  tripStatus: 'WAITING_BUS',
  boardingMethod: null,
  boardingConfirmedAt: null,
  shouldTriggerBell: false,
  bellStatus: 'NOT_REQUESTED',
  bellRequestId: null,
  command: null,
  guideMessage: '버스 위치를 확인하는 중입니다.',
  shouldScanBeacon: false,
  arrivalPollIntervalSeconds: null,
};

export default function RidingScreen({ route, navigation }) {
  const { tripId, selectedRoute } = route.params;

  const bellHandledRef = useRef(false);
  const stoppedRef = useRef(false);
  const startingBeaconScanRef = useRef(false);
  const connectingBellRef = useRef(false);

  const { state, dispatch } = useTrip();
  const isFocused = useIsFocused();
  const status = { ...INITIAL_STATUS, ...state, ...(state.tripStatus === 'TRIP_DONE' ? { guideMessage: state.journeyRoute ? '이번 버스 구간에 도착했습니다. 실제로 내린 뒤 하차를 확인해 주세요.' : TRIP_COMPLETION_MESSAGE } : {}) };
  const {
    session,
    isConnected,
    notifyFailure,
    getActiveTripId,
    trackingError,
  } = useRealtime();

  const latestGuideRef = useRef(null);
  latestGuideRef.current = { state, isFocused, trackingError };
  const guideFlowRef = useRef(null);
  const guideStartedKeyRef = useRef(null);
  const guideMessage = status.remainingStations === 1 && status.bellStatus === 'PENDING'
    ? ONE_STOP_GUIDE_MESSAGE : status.guideMessage;

  const currentTripStatus = state.tripStatus ?? status.tripStatus;
  const boardingConfirmedAt =
    state.boardingConfirmedAt ?? status.boardingConfirmedAt;
  const isGuideTripActive = state.tripId === tripId &&
    ['ON_BUS', 'NEAR_DESTINATION'].includes(state.tripStatus);

  const activeTripIdRef = useRef(state.tripId);
  activeTripIdRef.current = state.tripId;

  const preserveTransferSpeechRef = useRef(false);
  preserveTransferSpeechRef.current = Boolean(state.journeyRoute && state.tripStatus === 'TRIP_DONE');

  const boardingConfirmedAtRef = useRef(boardingConfirmedAt);
  boardingConfirmedAtRef.current = boardingConfirmedAt;

  const waitBeforeRetry = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  useEffect(() => { bellHandledRef.current = false; guideStartedKeyRef.current = null; }, [tripId]);

  useEffect(() => {
    stoppedRef.current = state.tripId !== tripId || state.tripStatus === 'TRIP_DONE' || state.tripStatus === 'CANCELLED';
    if (!isFocused) return;
    if (state.journeyPhase === 'BUS_ALIGHT_CONFIRM' || (state.journeyRoute && !state.tripId)) navigation.navigate('Transfer');
    else if (!state.tripId) navigation.navigate('Main');
    if (trackingError) navigation.navigate('Error');
  }, [state.tripId, state.tripStatus, state.journeyRoute, state.journeyPhase, tripId, trackingError, isFocused]);

  const screenTitle = (() => {
    switch (currentTripStatus) {
      case 'WAITING_BUS':
        return '버스 탑승 대기';
      case 'NEAR_DESTINATION':
        return '하차 준비';
      case 'TRIP_DONE':
        return state.journeyRoute ? '버스 구간 도착' : '목적지 도착';
      case 'ON_BUS':
        return '버스 탑승 중';
      default:
        return '운행 상태 확인 중';
    }
  })();

  useFocusEffect(
    React.useCallback(() => {
      if (isConnected) return;

      const timer = setTimeout(() => {
        if (guideStartedKeyRef.current || !latestGuideRef.current.isFocused) return;
        Speech.speak('버스 위치를 확인하는 중입니다.', {
          language: 'ko',
        });
      }, 500);

      return () => {
        clearTimeout(timer);
        if (!preserveTransferSpeechRef.current && !guideFlowRef.current) Speech.stop();
      };
    }, [isConnected]),
  );

  useEffect(() => {
    if (isConnected || !isFocused || guideStartedKeyRef.current) return;

    if (status.tripStatus !== 'TRIP_DONE' && status.guideMessage && status.remainingStations !== 1) {
      const timer = setTimeout(() => {
        Speech.speak(status.guideMessage, { language: 'ko' });
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [status.guideMessage, status.remainingStations, status.tripStatus, isConnected]);

  // 운행 준비 단계에서 즉시 시작되지 못한 경우 서버 shouldScanBeacon 신호로 재시도한다.
  useEffect(() => {
    if (
      canStartBeaconScan({
        shouldScanBeacon: status.shouldScanBeacon,
        caneReady: state.caneReady,
        beaconScanActive: state.beaconScanActive,
        starting: startingBeaconScanRef.current,
      })
    ) {
      startingBeaconScanRef.current = true;
      const attemptTripId = tripId;

      const isStillWanted = () =>
        !stoppedRef.current &&
        isScreenTripActive(activeTripIdRef.current, attemptTripId) &&
        !boardingConfirmedAtRef.current;

      startBeaconScanWithRetry({
        startBeaconScan,
        isStillWanted,

        onStarted: () => {
          dispatch({
            type: 'SET_BEACON_SCAN_ACTIVE',
            active: true,
          });
        },

        onStartedTooLate: () =>
          stopBeaconScanWithRetry({
            stopBeaconScan,
            onStopped: () => undefined,
            onGaveUp: (error) => {
              console.log(
                '늦게 성공한 스캔을 되돌리지 못함:',
              );
              dispatch({
                type: 'SET_BEACON_SCAN_ACTIVE',
                active: true,
              });
            },
            wait: waitBeforeRetry,
          }),

        onGaveUp: (error) => {
          console.log(
            '비콘 스캔 시작을 상한까지 재시도했지만 실패:',
          );

          Speech.speak(
            '지팡이 진동 안내를 시작하지 못했습니다. 정류장에 계신 주변 분께 버스가 오면 알려 달라고 요청해 주세요.',
            { language: 'ko' },
          );
        },

        wait: (ms) =>
          new Promise((resolve) => setTimeout(resolve, ms)),
      }).finally(() => {
        startingBeaconScanRef.current = false;
      });
    }
  }, [
    status.shouldScanBeacon,
    state.caneReady,
    state.beaconScanActive,
  ]);

  // 탑승이 확정되면 하차벨 보드를 연결한다.
  //
  // GPS watch 중단이나 하차 화면 이동은 운행 취소가 아니다.
  // 실제 운행이 취소되거나 다른 운행으로 교체됐는지만 확인한다.
  useEffect(() => {
    if (
      getActiveTripId() !== tripId ||
      !boardingConfirmedAt ||
      state.bellConnected !== null ||
      connectingBellRef.current === tripId
    ) {
      return;
    }

    const targetBeaconId = state.targetBeaconId;

    if (!targetBeaconId) {
      if (!state.beaconPreparationCompleted) {
        console.log(
          '[BLE] targetBeaconId 준비 중 - 비콘 조회 완료까지 하차벨 연결 대기',
        );
        return;
      }

      console.log(
        '[BLE] 비콘 준비 완료 후에도 targetBeaconId 없음 - 하차벨 연결을 시작하지 않음',
      );

      dispatch({
        type: 'SET_BELL_CONNECTED',
        connected: false,
      });

      notifyFailure(
        createAssistDeviceStatusEvent({
          device: 'BELL',
          reason: 'NOT_CONNECTED',
          attempted: false,
          retryable: false,
        }),
      );

      return;
    }

    connectingBellRef.current = tripId;
    const attemptTripId = tripId;

    const isStillWanted = () =>
      isScreenTripActive(
        getActiveTripId(),
        attemptTripId,
      );

    connectBellWithRetry({
      connectBell: () =>
        connectBell(targetBeaconId, attemptTripId),

      isStillWanted,

      onConnected: () => {
        dispatch({
          type: 'SET_BELL_CONNECTED',
          connected: true,
        });
      },

      onConnectedTooLate: () =>
        disconnectBellsForTrip(attemptTripId),

      onGaveUp: () => {
        dispatch({
          type: 'SET_BELL_CONNECTED',
          connected: false,
        });

        notifyFailure(
          createAssistDeviceStatusEvent({
            device: 'BELL',
            reason: 'NOT_CONNECTED',
            attempted: true,
            retryable: false,
          }),
        );
      },

      onCancelled: () => {
        if (
          isScreenTripActive(
            getActiveTripId(),
            attemptTripId,
          )
        ) {
          dispatch({
            type: 'SET_BELL_CONNECTED',
            connected: false,
          });
        }
      },

      wait: waitBeforeRetry,
    }).finally(() => {
      if (
        connectingBellRef.current === attemptTripId
      ) {
        connectingBellRef.current = false;
      }
    });
  }, [
    boardingConfirmedAt,
    state.bellConnected,
    state.targetBeaconId,
    state.beaconPreparationCompleted,
    tripId,
    state.tripId,
  ]);

  useEffect(() => {
    const bellRequestId = status.bellRequestId;
    const journeyGeneration = state.journeyGeneration;
    const journeySegmentIndex = state.journeySegmentIndex;
    const journeyPhase = state.journeyPhase;
    const key = JSON.stringify([tripId, bellRequestId]);
    const isCurrent = () => {
      const latest = latestGuideRef.current;
      return latest.isFocused && !latest.trackingError && latest.state.tripId === tripId &&
        latest.state.journeyGeneration === journeyGeneration &&
        latest.state.journeySegmentIndex === journeySegmentIndex && latest.state.journeyPhase === journeyPhase &&
        (!latest.state.journeyRoute || (latest.state.journeyPhase === 'GUIDING' &&
          latest.state.journeyRoute.segments?.[latest.state.journeySegmentIndex]?.mode === 'BUS')) &&
        ['ON_BUS', 'NEAR_DESTINATION'].includes(latest.state.tripStatus) &&
        latest.state.bellRequestId === bellRequestId && latest.state.remainingStations === 1 &&
        latest.state.bellStatus === 'PENDING' && latest.state.command === 'STOP_REQUEST';
    };
    if (!isCurrent() || !boardingConfirmedAt || status.remainingStations !== 1 ||
      status.bellStatus !== 'PENDING' || !bellRequestId || status.command !== 'STOP_REQUEST' ||
      bellHandledRef.current || guideStartedKeyRef.current === key) return;

    guideStartedKeyRef.current = key;
    const flow = createOneStopAlightGuide({
      tripId, bellRequestId, session: isConnected ? session : null,
      speech: NativeSpeech, isCurrent,
    });
    guideFlowRef.current = flow;
    void flow.start().then(playback => {
      if (playback === 'cancelled' || !isCurrent() || bellHandledRef.current) return;
      bellHandledRef.current = true;
      navigation.navigate('Alight', {
        tripId, bellRequestId, command: 'STOP_REQUEST',
        guideMessage: ONE_STOP_GUIDE_MESSAGE, guidePlayback: playback,
      });
    });
    return () => {
      // GPS completion has its own speech; do not stop that new utterance.
      flow.cancel(latestGuideRef.current.state.tripStatus !== 'TRIP_DONE');
      if (guideFlowRef.current === flow) guideFlowRef.current = null;
      if (!bellHandledRef.current && guideStartedKeyRef.current === key) guideStartedKeyRef.current = null;
    };
    // shouldTriggerBell is a one-response pulse. Subsequent PATCHes must not cancel
    // the captured server request while the same pending guide is playing.
  }, [tripId, status.bellRequestId, status.bellStatus, status.remainingStations,
    status.command, boardingConfirmedAt, isGuideTripActive, isFocused, trackingError,
    state.journeyGeneration, state.journeySegmentIndex, state.journeyPhase]);

  const isBoarded = Boolean(
    status.boardingConfirmedAt,
  );

  if (
    !isBoarded ||
    !status.currentStation ||
    !status.nextStation
  ) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>
          {screenTitle}
        </Text>

        <Text style={styles.subtitle}>
          지정한 목적지까지 안전하게 안내합니다.
        </Text>
        <VoiceRecoveryControl />

        <View style={styles.guideBox}>
          <Text style={styles.guideIcon}>
            🔊
          </Text>

          <Text style={styles.guideText}>
            {guideMessage}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        {screenTitle}
      </Text>

      <Text style={styles.subtitle}>
        지정한 목적지까지 안전하게 안내합니다.
      </Text>
      <VoiceRecoveryControl />

      <View style={styles.infoBox}>
        <View style={styles.labelRow}>
          <Text style={styles.labelIcon}>
            📍
          </Text>

          <Text style={styles.label}>
            현재 정류장
          </Text>
        </View>

        <Text style={styles.stationName}>
          {status.currentStation.stationName}
        </Text>
      </View>

      <View
        style={[
          styles.infoBox,
          styles.infoBoxHighlight,
        ]}
      >
        <View style={styles.labelRow}>
          <Text style={styles.labelIcon}>
            ➡️
          </Text>

          <Text
            style={[
              styles.label,
              styles.labelOnHighlight,
            ]}
          >
            다음 정류장
          </Text>
        </View>

        <Text style={styles.stationName}>
          {status.nextStation.stationName}
        </Text>
      </View>

      <View style={styles.remainBox}>
        <View style={styles.labelRow}>
          <Text style={styles.labelIcon}>
            ℹ️
          </Text>

          <Text style={styles.remainText}>
            남은 정류장
          </Text>
        </View>

        <Text style={styles.remainCount}>
          {status.remainingStations}
        </Text>
      </View>

      <View style={styles.guideBox}>
        <Text style={styles.guideIcon}>
          🔊
        </Text>

        <Text style={styles.guideText}>
          {guideMessage}
        </Text>
      </View>

      {status.remainingStations === 2 && (
        <View style={styles.prepareBox}>
          <Text style={styles.prepareText}>
            ⚠️ 곧 하차 준비하세요
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0C10',
    padding: 20,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFD400',
    textAlign: 'left',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#9CA3AF',
    marginBottom: 20,
  },
  infoBox: {
    backgroundColor: '#15181F',
    borderWidth: 1,
    borderColor: '#2A2E37',
    padding: 18,
    borderRadius: 16,
    marginBottom: 14,
  },
  infoBoxHighlight: {
    borderColor: '#FFD400',
    borderWidth: 1.5,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  labelIcon: {
    fontSize: 13,
    marginRight: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  labelOnHighlight: {
    color: '#FFD400',
  },
  stationName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  remainBox: {
    backgroundColor: '#15181F',
    borderWidth: 1,
    borderColor: '#2A2E37',
    padding: 18,
    borderRadius: 16,
    marginBottom: 14,
    alignItems: 'center',
  },
  remainText: {
    fontSize: 14,
    color: '#9CA3AF',
    fontWeight: '600',
  },
  remainCount: {
    fontSize: 40,
    fontWeight: '800',
    color: '#FFD400',
  },
  guideBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFC400',
    padding: 18,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    marginBottom: 14,
  },
  guideIcon: {
    fontSize: 18,
    marginRight: 10,
  },
  guideText: {
    flex: 1,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '700',
    color: '#111111',
  },
  prepareBox: {
    backgroundColor: '#2A1A0A',
    borderWidth: 2,
    borderColor: '#E65100',
    padding: 14,
    borderRadius: 16,
    marginBottom: 14,
    alignItems: 'center',
  },
  prepareText: {
    fontSize: 16,
    color: '#FFA766',
    fontWeight: '800',
  },
});
