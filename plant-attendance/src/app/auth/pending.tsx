import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { API_URL, STORAGE_KEYS } from "../../constants/config";


export default function PendingScreen() {
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [empName, setEmpName] = useState("");

  useEffect(() => {
    loadName();
  }, []);

  const loadName = async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.EMPLOYEE);
    if (raw) {
      const emp = JSON.parse(raw);
      setEmpName(`${emp.EMPNAME} ${emp.EMPFNAME}`);
    }
  };

  const checkStatus = async () => {
    setChecking(true);
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.EMPLOYEE);
      if (!raw) return;
      const employee = JSON.parse(raw);
      const deviceId = employee.DEVICEID;

      const res = await fetch(
        `${API_URL}/employees/${employee.EMP_ID}/status?deviceId=${deviceId}`
      );
      const data = await res.json();

      if (data.success && data.data.STATUS === "A") {
        const updated = { ...employee, ...data.data };
        await AsyncStorage.setItem(STORAGE_KEYS.EMPLOYEE, JSON.stringify(updated));

        if (updated.EMPTYPE === "SUPERVISOR") {
          router.replace("/supervisor/home");
        } else {
          router.replace("/individual/home");
        }
      } else {
        Alert.alert(
          "Still Pending",
          "Your registration hasn't been approved yet. Please check back later."
        );
      }
    } catch {
      Alert.alert("Error", "Failed to check status. Try again.");
    } finally {
      setChecking(false);
    }
  };

  const handleLogout = async () => {
    await AsyncStorage.removeItem(STORAGE_KEYS.EMPLOYEE);
    router.replace("/auth/select-employee");
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <Ionicons name="hourglass-outline" size={52} color="#E8A020" />
        </View>

        <Text style={styles.title}>Awaiting Approval</Text>
        <Text style={styles.sub}>
          Hi <Text style={styles.name}>{empName}</Text>, your registration has
          been submitted. An admin needs to approve your account before you can
          proceed.
        </Text>

        <View style={styles.steps}>
          <Step done text="Selected your name" />
          <Step done text="Submitted photo" />
          <Step pending text="Admin approval" />
          <Step pending text="Access granted" />
        </View>

        <TouchableOpacity
          style={styles.checkBtn}
          onPress={checkStatus}
          disabled={checking}
        >
          {checking ? (
            <ActivityIndicator color="#0D0D0D" />
          ) : (
            <>
              <Ionicons name="refresh" size={18} color="#0D0D0D" />
              <Text style={styles.checkBtnText}>Check Status</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutText}>Switch Account</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function Step({ done, pending, text }: { done?: boolean; pending?: boolean; text: string }) {
  return (
    <View style={stepStyles.row}>
      <View style={[stepStyles.dot, done && stepStyles.dotDone, pending && stepStyles.dotPending]}>
        {done && <Ionicons name="checkmark" size={12} color="#0D0D0D" />}
        {pending && <View style={stepStyles.dotInner} />}
      </View>
      <Text style={[stepStyles.text, done && stepStyles.textDone]}>{text}</Text>
    </View>
  );
}

const stepStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  dot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#222",
    borderWidth: 2,
    borderColor: "#333",
    justifyContent: "center",
    alignItems: "center",
  },
  dotDone: { backgroundColor: "#E8A020", borderColor: "#E8A020" },
  dotPending: { borderColor: "#333" },
  dotInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#333" },
  text: { color: "#555", fontSize: 14 },
  textDone: { color: "#CCC" },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0D0D0D" },
  content: {
    flex: 1,
    paddingHorizontal: 32,
    paddingTop: 60,
    alignItems: "center",
  },
  iconWrap: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#1A1200",
    borderWidth: 1,
    borderColor: "#2A2000",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 28,
  },
  title: {
    color: "#FFF",
    fontSize: 26,
    fontWeight: "800",
    marginBottom: 12,
    letterSpacing: -0.3,
  },
  sub: {
    color: "#555",
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 36,
  },
  name: { color: "#E8A020", fontWeight: "700" },
  steps: {
    alignSelf: "stretch",
    backgroundColor: "#111",
    borderRadius: 16,
    padding: 20,
    marginBottom: 32,
    borderWidth: 1,
    borderColor: "#1E1E1E",
  },
  checkBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E8A020",
    borderRadius: 14,
    paddingVertical: 16,
    gap: 8,
    alignSelf: "stretch",
    marginBottom: 14,
  },
  checkBtnText: { color: "#0D0D0D", fontWeight: "800", fontSize: 15 },
  logoutBtn: { paddingVertical: 12 },
  logoutText: { color: "#444", fontSize: 14 },
});