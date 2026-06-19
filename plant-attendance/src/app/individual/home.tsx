import {
  View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCallback, useState } from "react";
import { useRouter } from "expo-router";
import { useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { API_URL, STORAGE_KEYS } from "../../constants/config";
import { C } from "../../constants/theme";

type ShiftRecord = {
  STATUS:    "P" | "A";
  CREATEDAT: string;
  LOCATION:  string | null;
  SHIFT:     "DAY" | "NIGHT";
  LAT_VALUE:  string | null;
  LONG_VALUE: string | null;
} | null;

type AttendanceData = {
  currentShift:         "DAY" | "NIGHT";
  dayRecord:            ShiftRecord;
  nightRecord:          ShiftRecord;
  activeRecord:         ShiftRecord;   // the record for the current shift
  isCurrentShiftMarked: boolean;
};

export default function IndividualHomeScreen() {
  const router = useRouter();
  const [employee,      setEmployee]  = useState<any>(null);
  const [attendance,    setAttendance] = useState<AttendanceData | null>(null);
  const [loading,       setLoading]   = useState(true);
  const [markingAbsent, setMarkingAbsent] = useState(false);

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  useFocusEffect(
    useCallback(() => { loadData(); }, [])
  );

  const loadData = async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.EMPLOYEE);
      if (!raw) return;
      const emp = JSON.parse(raw);
      setEmployee(emp);

      const res  = await fetch(`${API_URL}/attendance/${emp.EMP_ID}/today`);
      const data = await res.json();
      if (data.success && data.data) {
        setAttendance(data.data);
      } else {
        // No records yet today — still need to know the current shift
        setAttendance({
          currentShift:         getCurrentShiftLocal(),
          dayRecord:            null,
          nightRecord:          null,
          activeRecord:         null,
          isCurrentShiftMarked: false,
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Client-side shift helper (display only — server is source of truth for saving)
  const getCurrentShiftLocal = (): "DAY" | "NIGHT" => {
    return new Date().getHours() >= 20 ? "NIGHT" : "DAY";
  };

  const confirmAbsent = async () => {
    setMarkingAbsent(true);
    try {
      const fd = new FormData();
      fd.append("empId",  employee.EMP_ID);
      fd.append("status", "A");

      const res  = await fetch(`${API_URL}/attendance/mark`, {
        method:  "POST",
        headers: { Accept: "application/json" },
        body:    fd,
      });
      const data = await res.json();

      if (res.ok) {
        // Refresh from server to get the correctly-shifted record back
        await loadData();
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

  const currentShift  = attendance?.currentShift ?? getCurrentShiftLocal();
  const isMarked      = attendance?.isCurrentShiftMarked ?? false;
  const activeRecord  = attendance?.activeRecord ?? null;
  const isPresent     = activeRecord?.STATUS === "P";
  const dayRecord     = attendance?.dayRecord   ?? null;
  const nightRecord   = attendance?.nightRecord ?? null;

  const markedTime = activeRecord?.CREATEDAT
    ? new Date(activeRecord.CREATEDAT).toLocaleTimeString("en-IN", {
        hour: "2-digit", minute: "2-digit",
      })
    : null;

  const ShiftBadge = ({ shift }: { shift: "DAY" | "NIGHT" }) => (
    <View style={[styles.shiftBadge, shift === "NIGHT" && styles.shiftBadgeNight]}>
      <Ionicons
        name={shift === "DAY" ? "sunny-outline" : "moon-outline"}
        size={12}
        color={shift === "DAY" ? C.amber : "#818CF8"}
      />
      <Text style={[styles.shiftBadgeText, shift === "NIGHT" && styles.shiftBadgeTextNight]}>
        {shift} SHIFT
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greeting}>Hello,</Text>
          <Text style={styles.empName}>{employee?.EMPNAME}</Text>
          <Text style={styles.empDesg}>{employee?.EMPDESG}</Text>
        </View>
        <ShiftBadge shift={currentShift} />
      </View>

      {/* Date */}
      <View style={styles.dateCard}>
        <Ionicons name="calendar-outline" size={16} color={C.primary} />
        <Text style={styles.dateText}>{today}</Text>
      </View>

      {/* Other-shift summary strip — only show if the OTHER shift has a record */}
      {currentShift === "NIGHT" && dayRecord && (
        <View style={styles.otherShiftStrip}>
          <Ionicons name="sunny-outline" size={14} color={C.amber} />
          <Text style={styles.otherShiftText}>
            Day shift:{" "}
            <Text style={{ fontWeight: "700", color: dayRecord.STATUS === "P" ? C.green : C.red }}>
              {dayRecord.STATUS === "P" ? "Present" : "Absent"}
            </Text>
            {dayRecord.CREATEDAT
              ? `  ·  ${new Date(dayRecord.CREATEDAT).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`
              : ""}
          </Text>
        </View>
      )}
      {currentShift === "DAY" && nightRecord && (
        <View style={[styles.otherShiftStrip, styles.otherShiftStripNight]}>
          <Ionicons name="moon-outline" size={14} color="#818CF8" />
          <Text style={styles.otherShiftText}>
            Night shift:{" "}
            <Text style={{ fontWeight: "700", color: nightRecord.STATUS === "P" ? C.green : C.red }}>
              {nightRecord.STATUS === "P" ? "Present" : "Absent"}
            </Text>
          </Text>
        </View>
      )}

      {/* Main */}
      <View style={styles.mainArea}>
        {!isMarked ? (
          /* ── Not yet marked for current shift ── */
          <>
            <View style={styles.pendingIcon}>
              <Ionicons name="finger-print-outline" size={52} color={C.primary} />
            </View>
            <Text style={styles.mainTitle}>Mark Your Attendance</Text>
            <Text style={styles.mainSub}>
              Mark your attendance for the{" "}
              <Text style={{ fontWeight: "700", color: currentShift === "DAY" ? C.amber : "#818CF8" }}>
                {currentShift}
              </Text>{" "}
              shift.
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
                  `Mark yourself absent for the ${currentShift} shift?`,
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
          /* ── Already marked for current shift ── */
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
                ? `Attendance recorded for the ${currentShift} shift.`
                : `You've been marked absent for the ${currentShift} shift.`}
            </Text>

            {markedTime && (
              <View style={styles.infoRow}>
                <Ionicons name="time-outline" size={16} color={C.textMuted} />
                <Text style={styles.infoText}>Marked at {markedTime}</Text>
              </View>
            )}
            {activeRecord?.LOCATION && (
              <View style={styles.infoRow}>
                <Ionicons name="location-outline" size={16} color={C.textMuted} />
                <Text style={styles.infoText}>{activeRecord.LOCATION}</Text>
              </View>
            )}

            <View style={[styles.statusChip, isPresent ? styles.chipP : styles.chipA]}>
              <Text style={[styles.statusChipText, { color: isPresent ? C.green : C.red }]}>
                {isPresent ? "PRESENT" : "ABSENT"}
              </Text>
            </View>

            <View style={styles.alreadyMarkedBox}>
              <Ionicons name="lock-closed-outline" size={16} color={C.textMuted} />
              <Text style={styles.alreadyMarkedText}>
                {currentShift} shift attendance recorded
              </Text>
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.pageBg },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start",
    paddingHorizontal: 24, paddingTop: 20, paddingBottom: 20,
  },
  greeting:  { color: C.textMuted,   fontSize: 14, marginBottom: 2 },
  empName:   { color: C.textPrimary, fontSize: 24, fontWeight: "800", letterSpacing: -0.3 },
  empDesg:   { color: C.textMuted,   fontSize: 13, marginTop: 4 },
  shiftBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: C.amberBg, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: C.amberLight,
  },
  shiftBadgeNight:    { backgroundColor: "#EEF2FF", borderColor: "#C7D2FE" },
  shiftBadgeText:     { color: C.amber, fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },
  shiftBadgeTextNight:{ color: "#818CF8" },
  dateCard: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 24, backgroundColor: C.primaryLight,
    borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.primaryMuted, marginBottom: 8,
  },
  dateText: { color: C.textSecondary, fontSize: 14 },
  otherShiftStrip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginHorizontal: 24, marginBottom: 16, marginTop: 8,
    backgroundColor: C.amberBg, borderRadius: 10,
    paddingVertical: 8, paddingHorizontal: 12,
    borderWidth: 1, borderColor: C.amberLight,
  },
  otherShiftStripNight: { backgroundColor: "#EEF2FF", borderColor: "#C7D2FE" },
  otherShiftText:       { color: C.textSecondary, fontSize: 13, flex: 1 },
  mainArea:   { flex: 1, paddingHorizontal: 24, alignItems: "center", paddingTop: 24 },
  pendingIcon: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: C.primaryLight, borderWidth: 1, borderColor: C.primaryMuted,
    justifyContent: "center", alignItems: "center", marginBottom: 24,
  },
  mainTitle: { color: C.textPrimary, fontSize: 22, fontWeight: "800", marginBottom: 10, textAlign: "center", letterSpacing: -0.3 },
  mainSub:   { color: C.textSecondary, fontSize: 14, textAlign: "center", lineHeight: 20, marginBottom: 32 },
  presentBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: C.primary, borderRadius: 16, paddingVertical: 18, gap: 10,
    alignSelf: "stretch", marginBottom: 12,
  },
  presentBtnText: { color: C.textInverse, fontSize: 17, fontWeight: "800" },
  absentBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: C.redBg, borderRadius: 16, paddingVertical: 18, gap: 10,
    alignSelf: "stretch", borderWidth: 1.5, borderColor: C.redLight,
  },
  absentBtnText: { color: C.red, fontSize: 17, fontWeight: "700" },
  markedIcon:  { width: 100, height: 100, borderRadius: 50, justifyContent: "center", alignItems: "center", marginBottom: 24 },
  markedIconP: { backgroundColor: C.greenBg },
  markedIconA: { backgroundColor: C.redBg },
  infoRow:  { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  infoText: { color: C.textSecondary, fontSize: 14 },
  statusChip: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20, borderWidth: 1, marginTop: 16 },
  chipP: { backgroundColor: C.greenBg, borderColor: C.greenLight },
  chipA: { backgroundColor: C.redBg,   borderColor: C.redLight },
  statusChipText: { fontSize: 13, fontWeight: "800", letterSpacing: 1.5 },
  alreadyMarkedBox: {
    flexDirection: "row", alignItems: "center", gap: 8, marginTop: 24,
    backgroundColor: C.inputBg, borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 20,
    borderWidth: 1, borderColor: C.border, alignSelf: "stretch", justifyContent: "center",
  },
  alreadyMarkedText: { color: C.textMuted, fontSize: 13, fontWeight: "600" },
});