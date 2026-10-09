import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useRealtime } from './RealtimeProvider';

export default function VoiceRecoveryControl() {
  const { recoverVoice, connectionStatus, connectionError, speechBlocked } = useRealtime();
  const focused = useIsFocused();
  const requestRef = useRef(null);
  useEffect(() => () => { requestRef.current?.abort(); }, [focused]);
  if (!focused || (connectionStatus === 'connected' && !speechBlocked)) return null;
  const recovering = connectionStatus === 'connecting';
  const recover = () => {
    if (recovering || requestRef.current) return;
    const request = new AbortController();
    requestRef.current = request;
    void recoverVoice(request.signal).finally(() => {
      if (requestRef.current === request) requestRef.current = null;
    });
  };
  return (
    <View style={styles.container}>
      <Text accessibilityRole="alert" style={styles.message}>
        {recovering ? '음성을 복구하는 중입니다.' : connectionError || '음성 안내를 복구할 수 있습니다.'}
      </Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="음성 복구" disabled={recovering}
        style={styles.button} onPress={recover}>
        <Text style={styles.label}>{recovering ? '음성 복구 중' : '음성 복구'}</Text>
      </TouchableOpacity>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { marginVertical: 8 },
  message: { color: '#FFFFFF', fontSize: 16, marginBottom: 6 },
  button: { backgroundColor: '#2F8FFF', minHeight: 48, padding: 12, borderRadius: 8, alignItems: 'center' },
  label: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
});
