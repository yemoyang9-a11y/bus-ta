import 'react-native-gesture-handler';
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';

import MainScreen from './src/screens/MainScreen';
import STTScreen from './src/screens/STTScreen';
import ConfirmScreen from './src/screens/ConfirmScreen';
import RouteListScreen from './src/screens/RouteListScreen';
import RidingScreen from './src/screens/RidingScreen';
import AlightScreen from './src/screens/AlightScreen';
import ErrorScreen from './src/screens/ErrorScreen';

const Stack = createStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator id={undefined} initialRouteName="Main">
        <Stack.Screen name="Main" component={MainScreen} options={{ title: '버스 도우미' }} />
        <Stack.Screen name="STT" component={STTScreen} options={{ title: '목적지 입력' }} />
        <Stack.Screen name="Confirm" component={ConfirmScreen} options={{ title: '목적지 확인' }} />
        <Stack.Screen name="RouteList" component={RouteListScreen} options={{ title: '노선 선택' }} />
        <Stack.Screen name="Riding" component={RidingScreen} options={{ title: '탑승 중' }} />
        <Stack.Screen name="Alight" component={AlightScreen} options={{ title: '하차 안내' }} />
        <Stack.Screen name="Error" component={ErrorScreen} options={{ title: '오류' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}