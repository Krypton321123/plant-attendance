import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { API_URL, STORAGE_KEYS } from "../../constants/config";

type TodayRecord = {
  STATUS: "P" | "A";
  CREATEDAT: string;
  LOCATION: string | null;
} | null;

export default function IndividualHomeScreen() {
  const router = useRouter();
  const [employee, setEmployee] = useState<any>(null);
  const [todayRecord, setTodayRecord] = useState<TodayRecord>(null);
  const [loading, setLoading] = useState(true);
  const [markingAbsent, setMarkingAbsent] = useState(false);

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.EMPLOYEE);
      if (!raw) return;
      const emp = JSON.parse(raw);
      setEmployee(emp);

      const res = await fetch(`${API_URL}/attendance/${emp.EMP_ID}/today`);
      const data = await res.json();
      if (data.success && data.data) {
        setTodayRecord(data.data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleMarkPresent = () => {
    // Go to camera screen
    router.push({
      pathname: "/camera/mark",
      params: {
        empId: employee.EMP_ID,
        empName: `${employee.EMPNAME} ${employee.EMPFNAME}`,
        isSelf: "true",
      },
    });
  };

  const handleMarkAbsent = () => {
    Alert.alert(
      "Mark Absent",
      "Are you sure you want to mark yourself as absent for today?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Mark Absent",
          style: "destructive",
          onPress: confirmAbsent,
        },
      ]
    );
  };

  const confirmAbsent = async () => {
    setMarkingAbsent(true);
    try {
      const formData = new FormData();
      formData.append("empId", employee.EMP_ID);
      formData.append("status", "A");

      const res = await fetch(`${API_URL}/attendance/mark`, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: formData,
      });
      const data = await res.json();

      if (res.ok) {
        setTodayRecord({ STATUS: "A", CREATEDAT: new Date().toISOString(), LOCATION: null });
      } else {
        Alert.alert("Error", data.message || "Failed to mark absent");
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

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#E8A020" style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  const isMarked = !!todayRecord;
  const isPresent = todayRecord?.STATUS === "P";
  const isAbsent = todayRecord?.STATUS === "A";

  const markedTime = todayRecord?.CREATEDAT
    ? new Date(todayRecord.CREATEDAT).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
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
        <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
          <Ionicons name="log-out-outline" size={22} color="#555" />
        </TouchableOpacity>
      </View>

      {/* Date card */}
      <View style={styles.dateCard}>
        <Ionicons name="calendar-outline" size={18} color="#E8A020" />
        <Text style={styles.dateText}>{today}</Text>
      </View>

      {/* Status / Action area */}
      <View style={styles.mainArea}>
        {!isMarked ? (
          <>
            <View style={styles.pendingIcon}>
              <Ionicons name="finger-print-outline" size={52} color="#E8A020" />
            </View>
            <Text style={styles.mainTitle}>Mark Your Attendance</Text>
            <Text style={styles.mainSub}>
              Please mark your attendance for today before leaving.
            </Text>

            <TouchableOpacity style={styles.presentBtn} onPress={handleMarkPresent}>
              <Ionicons name="camera-outline" size={22} color="#0D0D0D" />
              <Text style={styles.presentBtnText}>Mark Present</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.absentBtn}
              onPress={handleMarkAbsent}
              disabled={markingAbsent}
            >
              {markingAbsent ? (
                <ActivityIndicator color="#EF4444" size="small" />
              ) : (
                <>
                  <Ionicons name="close-circle-outline" size={22} color="#EF4444" />
                  <Text style={styles.absentBtnText}>Mark Absent</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View
              style={[
                styles.markedIcon,
                isPresent ? styles.markedIconP : styles.markedIconA,
              ]}
            >
              <Ionicons
                name={isPresent ? "checkmark-circle" : "close-circle"}
                size={56}
                color={isPresent ? "#22C55E" : "#EF4444"}
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
              <View style={styles.timeRow}>
                <Ionicons name="time-outline" size={16} color="#555" />
                <Text style={styles.timeText}>Marked at {markedTime}</Text>
              </View>
            )}

            {todayRecord?.LOCATION && (
              <View style={styles.locationRow}>
                <Ionicons name="location-outline" size={16} color="#555" />
                <Text style={styles.locationText}>{todayRecord.LOCATION}</Text>
              </View>
            )}

            <View
              style={[
                styles.statusChip,
                isPresent ? styles.chipP : styles.chipA,
              ]}
            >
              <Text
                style={[
                  styles.statusChipText,
                  { color: isPresent ? "#22C55E" : "#EF4444" },
                ]}
              >
                {isPresent ? "PRESENT" : "ABSENT"}
              </Text>
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0D0D0D" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 20,
  },
  greeting: { color: "#555", fontSize: 14, marginBottom: 2 },
  empName: { color: "#FFF", fontSize: 24, fontWeight: "800", letterSpacing: -0.3 },
  empDesg: { color: "#555", fontSize: 13, marginTop: 4 },
  logoutBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#1A1A1A",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#222",
  },
  dateCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 24,
    backgroundColor: "#141414",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#1E1E1E",
    marginBottom: 24,
  },
  dateText: { color: "#888", fontSize: 14 },
  mainArea: {
    flex: 1,
    paddingHorizontal: 24,
    alignItems: "center",
    paddingTop: 32,
  },
  pendingIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#1A1200",
    borderWidth: 1,
    borderColor: "#2A2000",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
  },
  mainTitle: {
    color: "#FFF",
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 10,
    textAlign: "center",
    letterSpacing: -0.3,
  },
  mainSub: {
    color: "#555",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 32,
  },
  presentBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E8A020",
    borderRadius: 16,
    paddingVertical: 18,
    gap: 10,
    alignSelf: "stretch",
    marginBottom: 12,
  },
  presentBtnText: { color: "#0D0D0D", fontSize: 17, fontWeight: "800" },
  absentBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1A0A0A",
    borderRadius: 16,
    paddingVertical: 18,
    gap: 10,
    alignSelf: "stretch",
    borderWidth: 1.5,
    borderColor: "#3D1515",
  },
  absentBtnText: { color: "#EF4444", fontSize: 17, fontWeight: "700" },
  markedIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
  },
  markedIconP: { backgroundColor: "#052011" },
  markedIconA: { backgroundColor: "#1A0505" },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  timeText: { color: "#555", fontSize: 14 },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 24,
  },
  locationText: { color: "#555", fontSize: 13 },
  statusChip: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipP: { backgroundColor: "#052011", borderColor: "#166534" },
  chipA: { backgroundColor: "#1A0505", borderColor: "#7F1D1D" },
  statusChipText: { fontSize: 13, fontWeight: "800", letterSpacing: 1.5 },
});