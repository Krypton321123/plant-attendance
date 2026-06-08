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
      const adminRaw = await AsyncStorage.getItem(STORAGE_KEYS.ADMIN);
      if (adminRaw) {
        router.replace("/admin/home");
        return;
      }

      const raw = await AsyncStorage.getItem(STORAGE_KEYS.EMPLOYEE);
      if (!raw) {
        router.replace("/auth/select-employee");
        return;
      }

      const employee = JSON.parse(raw);
      const deviceId = employee.DEVICEID; // ← read from employee, not separately

      if (!deviceId) {
        // Employee selected but never went through registration
        router.replace("/auth/select-employee");
        return;
      }

      const res = await fetch(
        `${API_URL}/employees/${employee.EMP_ID}/status?deviceId=${deviceId}`,
      );
      const data = await res.json();

      if (!data.success) {
        await AsyncStorage.removeItem(STORAGE_KEYS.EMPLOYEE);
        router.replace("/auth/select-employee");
        return;
      }

      const updated = { ...employee, ...data.data };
      await AsyncStorage.setItem(
        STORAGE_KEYS.EMPLOYEE,
        JSON.stringify(updated),
      );

      if (updated.STATUS !== "A") {
        router.replace("/auth/pending");
        return;
      }

      console.log("updated", updated)

      switch (updated.EMPTYPE) {
        case "ADMIN":
          router.replace("/admin/home");
          break;
        case "SUPERVISOR":
          router.replace("/supervisor/home");
          break;
        case "PPSUPERVISOR":
          router.replace("/supervisor/home");
          break;
        case "OFFICE":
          router.replace("/supervisor/home");
          break;
        default:
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
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
  },
});
