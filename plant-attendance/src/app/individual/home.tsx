import {
  View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { API_URL, STORAGE_KEYS } from "../../constants/config";
import { C } from "../../constants/theme";

type TodayRecord = { STATUS: "P" | "A"; CREATEDAT: string; LOCATION: string | null } | null;

export default function IndividualHomeScreen() {
  const router = useRouter();
  const [employee,      setEmployee]      = useState<any>(null);
  const [todayRecord,   setTodayRecord]   = useState<TodayRecord>(null);
  const [loading,       setLoading]       = useState(true);
  const [markingAbsent, setMarkingAbsent] = useState(false);

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.EMPLOYEE);
      if (!raw) return;
      const emp = JSON.parse(raw);
      setEmployee(emp);
      const res  = await fetch(`${API_URL}/attendance/${emp.EMP_ID}/today`);
      const data = await res.json();
      if (data.success && data.data) setTodayRecord(data.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const confirmAbsent = async () => {
    setMarkingAbsent(true);
    try {
      const fd = new FormData();
      fd.append("empId", employee.EMP_ID);
      fd.append("status", "A");
      const res  = await fetch(`${API_URL}/attendance/mark`, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: fd,
      });
      const data = await res.json();
      if (res.ok) {
        setTodayRecord({ STATUS: "A", CREATEDAT: new Date().toISOString(), LOCATION: null });
      } else {
        Alert.alert("Error", data.message || "Failed");
      }
    } catch {
      Alert.alert("Error", "Something went wrong");
    } finally {
      setMarkingAbsent(false);
    }
  };

  const handleLogout = async () => {
    Alert.alert("Switch Account", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Switch",
        style: "destructive",
        onPress: async () => {
          await AsyncStorage.removeItem(STORAGE_KEYS.EMPLOYEE);
          router.replace("/auth/select-employee");
        },
      },
    ]);
  };

  if (loading) return (
    <SafeAreaView style={styles.container}>
      <ActivityIndicator size="large" color={C.primary} style={{ marginTop: 80 }} />
    </SafeAreaView>
  );

  const isMarked   = !!todayRecord;
  const isPresent  = todayRecord?.STATUS === "P";
  const markedTime = todayRecord?.CREATEDAT
    ? new Date(todayRecord.CREATEDAT).toLocaleTimeString("en-IN", {
        hour: "2-digit", minute: "2-digit",
      })
    : null;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hello,</Text>
          <Text style={styles.empName}>{employee?.EMPNAME}</Text>
          <Text style={styles.empDesg}>{employee?.EMPDESG}</Text>
        </View>
        
      </View>

      {/* Date */}
      <View style={styles.dateCard}>
        <Ionicons name="calendar-outline" size={16} color={C.primary} />
        <Text style={styles.dateText}>{today}</Text>
      </View>

      {/* Main */}
      <View style={styles.mainArea}>
        {!isMarked ? (
          /* ── Not yet marked ── */
          <>
            <View style={styles.pendingIcon}>
              <Ionicons name="finger-print-outline" size={52} color={C.primary} />
            </View>
            <Text style={styles.mainTitle}>Mark Your Attendance</Text>
            <Text style={styles.mainSub}>
              Please mark your attendance for today before you leave.
            </Text>

            <TouchableOpacity
              style={styles.presentBtn}
              onPress={() =>
                router.push({
                  pathname: "/camera/mark",
                  params: {
                    empId:   employee.EMP_ID,
                    empName: `${employee.EMPNAME} ${employee.EMPFNAME}`,
                    isSelf:  "true",
                  },
                })
              }
            >
              <Ionicons name="camera-outline" size={22} color={C.textInverse} />
              <Text style={styles.presentBtnText}>Mark Present</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.absentBtn}
              onPress={() =>
                Alert.alert(
                  "Mark Absent",
                  "Are you sure you want to mark yourself absent?",
                  [
                    { text: "Cancel", style: "cancel" },
                    { text: "Mark Absent", style: "destructive", onPress: confirmAbsent },
                  ]
                )
              }
              disabled={markingAbsent}
            >
              {markingAbsent ? (
                <ActivityIndicator color={C.red} size="small" />
              ) : (
                <>
                  <Ionicons name="close-circle-outline" size={22} color={C.red} />
                  <Text style={styles.absentBtnText}>Mark Absent</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        ) : (
          /* ── Already marked ── */
          <>
            <View style={[styles.markedIcon, isPresent ? styles.markedIconP : styles.markedIconA]}>
              <Ionicons
                name={isPresent ? "checkmark-circle" : "close-circle"}
                size={56}
                color={isPresent ? C.green : C.red}
              />
            </View>

            <Text style={styles.mainTitle}>
              {isPresent ? "You're Present Today" : "Marked Absent"}
            </Text>
            <Text style={styles.mainSub}>
              {isPresent
                ? "Your attendance has been recorded successfully."
                : "You have been marked absent for today."}
            </Text>

            {markedTime && (
              <View style={styles.infoRow}>
                <Ionicons name="time-outline" size={16} color={C.textMuted} />
                <Text style={styles.infoText}>Marked at {markedTime}</Text>
              </View>
            )}
            {todayRecord?.LOCATION && (
              <View style={styles.infoRow}>
                <Ionicons name="location-outline" size={16} color={C.textMuted} />
                <Text style={styles.infoText}>{todayRecord.LOCATION}</Text>
              </View>
            )}

            <View style={[styles.statusChip, isPresent ? styles.chipP : styles.chipA]}>
              <Text style={[styles.statusChipText, { color: isPresent ? C.green : C.red }]}>
                {isPresent ? "PRESENT" : "ABSENT"}
              </Text>
            </View>

            {/* Locked action area */}
            <View style={styles.alreadyMarkedBox}>
              <Ionicons name="lock-closed-outline" size={16} color={C.textMuted} />
              <Text style={styles.alreadyMarkedText}>
                Attendance already recorded for today
              </Text>
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: C.pageBg },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start",
    paddingHorizontal: 24, paddingTop: 20, paddingBottom: 20,
  },
  greeting:      { color: C.textMuted,   fontSize: 14, marginBottom: 2 },
  empName:       { color: C.textPrimary, fontSize: 24, fontWeight: "800", letterSpacing: -0.3 },
  empDesg:       { color: C.textMuted,   fontSize: 13, marginTop: 4 },
  logoutBtn: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: C.cardBg,
    justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: C.border,
  },
  dateCard: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 24, backgroundColor: C.primaryLight,
    borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.primaryMuted, marginBottom: 24,
  },
  dateText:      { color: C.textSecondary, fontSize: 14 },
  mainArea:      { flex: 1, paddingHorizontal: 24, alignItems: "center", paddingTop: 32 },
  pendingIcon: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: C.primaryLight, borderWidth: 1, borderColor: C.primaryMuted,
    justifyContent: "center", alignItems: "center", marginBottom: 24,
  },
  mainTitle:     { color: C.textPrimary, fontSize: 22, fontWeight: "800", marginBottom: 10, textAlign: "center", letterSpacing: -0.3 },
  mainSub:       { color: C.textSecondary, fontSize: 14, textAlign: "center", lineHeight: 20, marginBottom: 32 },
  presentBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: C.primary, borderRadius: 16, paddingVertical: 18, gap: 10,
    alignSelf: "stretch", marginBottom: 12,
  },
  presentBtnText:{ color: C.textInverse, fontSize: 17, fontWeight: "800" },
  absentBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: C.redBg, borderRadius: 16, paddingVertical: 18, gap: 10,
    alignSelf: "stretch", borderWidth: 1.5, borderColor: C.redLight,
  },
  absentBtnText: { color: C.red, fontSize: 17, fontWeight: "700" },
  markedIcon:    { width: 100, height: 100, borderRadius: 50, justifyContent: "center", alignItems: "center", marginBottom: 24 },
  markedIconP:   { backgroundColor: C.greenBg },
  markedIconA:   { backgroundColor: C.redBg },
  infoRow:       { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  infoText:      { color: C.textSecondary, fontSize: 14 },
  statusChip:    { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20, borderWidth: 1, marginTop: 16 },
  chipP:         { backgroundColor: C.greenBg, borderColor: C.greenLight },
  chipA:         { backgroundColor: C.redBg,   borderColor: C.redLight },
  statusChipText:{ fontSize: 13, fontWeight: "800", letterSpacing: 1.5 },
  alreadyMarkedBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 24,
    backgroundColor: C.inputBg,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: C.border,
    alignSelf: "stretch",
    justifyContent: "center",
  },
  alreadyMarkedText: {
    color: C.textMuted,
    fontSize: 13,
    fontWeight: "600",
  },
});