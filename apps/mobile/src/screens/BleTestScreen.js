import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import {
  connectAll,
  setTargetBeacon,
  startBeaconScan,
  stopBeaconScan,
  sendStopRequest,
  subscribeBellResult,
  disconnect,
} from '../ble/bleManager';

// BLE 기능만 단독으로 테스트하기 위한 임시 화면 (정민님 하차벨/지팡이 실물 테스트용)
// 정식 서비스 흐름과 무관하며, 테스트 끝나면 App.tsx의 initialRouteName을 되돌리면 됨
export default function BleTestScreen() {
  const [logs, setLogs] = useState([]);
  const [unsubscribe, setUnsubscribe] = useState(null);

  const addLog = (message) => {
    const time = new Date().toLocaleTimeString('ko-KR');
    setLogs((prev) => [`[${time}] ${message}`, ...prev]);
  };

  const handleConnectAll = async () => {
    addLog('지팡이·하차벨 연결 시도 중...');
    try {
      const connected = await connectAll();
      addLog(`연결 결과: 지팡이=${connected.has('White_cane')}, 하차벨=${connected.has('BUS_35_001')}`);
    } catch (error) {
      addLog(`연결 실패: ${error.message}`);
    }
  };

  const handleSetTargetBeacon = async () => {
    addLog('타겟 비콘 설정 시도 중 (BUS_35_001)...');
    try {
      await setTargetBeacon('BUS_35_001');
      addLog('타겟 비콘 설정 성공');
    } catch (error) {
      addLog(`타겟 비콘 설정 실패: ${error.message}`);
    }
  };

  const handleStartScan = async () => {
    addLog('비콘 스캔 시작 명령 전송 중...');
    try {
      await startBeaconScan();
      addLog('스캔 시작 성공');
    } catch (error) {
      addLog(`스캔 시작 실패: ${error.message}`);
    }
  };

  const handleStopScan = async () => {
    addLog('비콘 스캔 중지 명령 전송 중...');
    try {
      await stopBeaconScan();
      addLog('스캔 중지 성공');
    } catch (error) {
      addLog(`스캔 중지 실패: ${error.message}`);
    }
  };

  const handleSubscribeBellResult = () => {
    addLog('하차벨 결과 구독 시작...');
    try {
      const unsub = subscribeBellResult((result) => {
        addLog(`하차벨 결과 수신: ${JSON.stringify(result)}`);
      });
      setUnsubscribe(() => unsub);
      addLog('구독 성공');
    } catch (error) {
      addLog(`구독 실패: ${error.message}`);
    }
  };

  const handleSendStopRequest = async () => {
    addLog('STOP_REQUEST 전송 중...');
    try {
      await sendStopRequest();
      addLog('STOP_REQUEST 전송 성공');
    } catch (error) {
      addLog(`STOP_REQUEST 전송 실패: ${error.message}`);
    }
  };

  const handleDisconnectAll = async () => {
    addLog('연결 해제 중...');
    if (unsubscribe) {
      unsubscribe();
      setUnsubscribe(null);
    }
    try {
      await disconnect('White_cane');
      await disconnect('BUS_35_001');
      addLog('연결 해제 완료');
    } catch (error) {
      addLog(`연결 해제 실패: ${error.message}`);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>BLE 테스트 화면</Text>

      <TouchableOpacity style={styles.button} onPress={handleConnectAll}>
        <Text style={styles.buttonText}>지팡이·하차벨 연결</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.button} onPress={handleSetTargetBeacon}>
        <Text style={styles.buttonText}>타겟 비콘 설정 (BUS_35_001)</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.button} onPress={handleStartScan}>
        <Text style={styles.buttonText}>스캔 시작</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.button} onPress={handleStopScan}>
        <Text style={styles.buttonText}>스캔 중지</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.button} onPress={handleSubscribeBellResult}>
        <Text style={styles.buttonText}>하차벨 결과 구독 시작</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.button, styles.primaryButton]} onPress={handleSendStopRequest}>
        <Text style={styles.buttonText}>STOP_REQUEST 보내기</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={handleDisconnectAll}>
        <Text style={styles.buttonText}>연결 해제</Text>
      </TouchableOpacity>

      <Text style={styles.logTitle}>로그</Text>
      <ScrollView style={styles.logBox}>
        {logs.map((log, index) => (
          <Text key={index} style={styles.logText}>{log}</Text>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 16,
    paddingTop: 40,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#2196F3',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  primaryButton: {
    backgroundColor: '#B3261E',
  },
  dangerButton: {
    backgroundColor: '#888',
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  logTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 12,
    marginBottom: 4,
  },
  logBox: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 8,
  },
  logText: {
    fontSize: 12,
    color: '#333',
    marginBottom: 4,
  },
});