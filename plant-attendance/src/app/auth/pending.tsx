import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, Alert,
} from "react-native";
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { API_URL, STORAGE_KEYS } from "../../constants/config";
import { C } from "../../constants/theme";

export default function PendingScreen() {
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [empName,  setEmpName]  = useState("");

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEYS.EMPLOYEE).then(raw => {
      if (raw) { const emp = JSON.parse(raw); setEmpName(`${emp.EMPNAME} ${emp.EMPFNAME}`); }
    });
  }, []);

  const checkStatus = async () => {
    setChecking(true);
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.EMPLOYEE);
      if (!raw) return;
      const employee = JSON.parse(raw);
      const res  = await fetch(`${API_URL}/employees/${employee.EMP_ID}/status?deviceId=${employee.DEVICEID}`);
      const data = await res.json();
      if (data.success && data.data.STATUS === "A") {
        const updated = { ...employee, ...data.data };
        await AsyncStorage.setItem(STORAGE_KEYS.EMPLOYEE, JSON.stringify(updated));
        router.replace(updated.EMPTYPE === "SUPERVISOR" || updated.EMPTYPE === "PPSUPERVISOR" ||  updated.EMPTYPE === "KPSUPERVISOR" ? "/supervisor/home" : "/individual/home");
      } else {
        Alert.alert("Still Pending", "Your registration hasn't been approved yet. Please check back later.");
      }
    } catch { Alert.alert("Error", "Failed to check status. Try again."); }
    finally  { setChecking(false); }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <Ionicons name="hourglass-outline" size={52} color={C.amber} />
        </View>
        <Text style={styles.title}>Awaiting Approval</Text>
        <Text style={styles.sub}>
          Hi <Text style={styles.name}>{empName}</Text>, your registration has been submitted.{"\n"}
          An admin needs to approve your account.
        </Text>

        <View style={styles.stepsCard}>
          <Step done text="Selected your name" />
          <Step done text="Submitted registration photo" />
          <Step pending text="Admin approval" />
          <Step pending text="Access granted" />
        </View>

        <TouchableOpacity style={styles.checkBtn} onPress={checkStatus} disabled={checking}>
          {checking
            ? <ActivityIndicator color={C.textInverse} />
            : <><Ionicons name="refresh" size={18} color={C.textInverse} /><Text style={styles.checkBtnText}>Check Status</Text></>
          }
        </TouchableOpacity>

        <TouchableOpacity style={styles.logoutBtn} onPress={async () => { await AsyncStorage.removeItem(STORAGE_KEYS.EMPLOYEE); router.replace("/auth/select-employee"); }}>
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
        {done    && <Ionicons name="checkmark" size={12} color={C.textInverse} />}
        {pending && <View style={stepStyles.dotInner} />}
      </View>
      <Text style={[stepStyles.text, done && stepStyles.textDone]}>{text}</Text>
    </View>
  );
}

const stepStyles = StyleSheet.create({
  row:       { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  dot: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: C.inputBg, borderWidth: 2, borderColor: C.border,
    justifyContent: "center", alignItems: "center",
  },
  dotDone:   { backgroundColor: C.primary, borderColor: C.primary },
  dotPending:{ borderColor: C.border },
  dotInner:  { width: 8, height: 8, borderRadius: 4, backgroundColor: C.border },
  text:      { color: C.textMuted,      fontSize: 14 },
  textDone:  { color: C.textPrimary,    fontWeight: "600" },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.pageBg },
  content:   { flex: 1, paddingHorizontal: 32, paddingTop: 60, alignItems: "center" },
  iconWrap: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: C.amberBg, borderWidth: 1.5, borderColor: C.amberLight,
    justifyContent: "center", alignItems: "center", marginBottom: 28,
  },
  title:    { color: C.textPrimary, fontSize: 26, fontWeight: "800", marginBottom: 12, letterSpacing: -0.3 },
  sub:      { color: C.textSecondary, fontSize: 15, textAlign: "center", lineHeight: 22, marginBottom: 36 },
  name:     { color: C.primary, fontWeight: "700" },
  stepsCard: {
    alignSelf: "stretch", backgroundColor: C.cardBg, borderRadius: 16, padding: 20,
    marginBottom: 32, borderWidth: 1, borderColor: C.border,
    shadowColor: "#0F172A", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  checkBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: C.primary, borderRadius: 14, paddingVertical: 16, gap: 8, alignSelf: "stretch", marginBottom: 14,
  },
  checkBtnText: { color: C.textInverse, fontWeight: "800", fontSize: 15 },
  logoutBtn:    { paddingVertical: 12 },
  logoutText:   { color: C.textMuted, fontSize: 14 },
});