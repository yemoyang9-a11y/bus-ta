import { StatusBar } from "expo-status-bar";
import { Text, View } from "react-native";

export default function App() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text>bus-ta — 시각장애인 대중교통 보조 시스템</Text>
      <StatusBar style="auto" />
    </View>
  );
}
