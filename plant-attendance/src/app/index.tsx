import { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { STORAGE_KEYS, API_URL } from "../constants/config";

export default function IndexScreen() {
  const router = useRouter();

  useEffect(() => {
    checkSession();
  }, []);

  const checkSession = async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.EMPLOYEE);
      if (!raw) {
        router.replace("/auth/select-employee");
        return;
      }

      const employee = JSON.parse(raw);
      const deviceId = await AsyncStorage.getItem(STORAGE_KEYS.DEVICE_ID);

      // Re-check approval status from server
      const res = await fetch(
        `${API_URL}/employees/${employee.EMP_ID}/status?deviceId=${deviceId}`
      );
      const data = await res.json();

      if (!data.success) {
        // Something's wrong, start fresh
        await AsyncStorage.removeItem(STORAGE_KEYS.EMPLOYEE);
        router.replace("/auth/select-employee");
        return;
      }

      const updated = { ...employee, ...data.data };
      await AsyncStorage.setItem(STORAGE_KEYS.EMPLOYEE, JSON.stringify(updated));

      if (updated.STATUS !== "A") {
        router.replace("/auth/pending");
        return;
      }

      if (updated.EMPTYPE === "SUPERVISOR") {
        router.replace("/supervisor/home");
      } else {
        router.replace("/individual/home");
      }
    } catch {
      router.replace("/auth/select-employee");
    }
  };

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#E8A020" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0D0D0D",
    justifyContent: "center",
    alignItems: "center",
  },
});