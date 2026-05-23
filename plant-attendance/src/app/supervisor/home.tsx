import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  SafeAreaView,
  Alert,
  Modal,
  RefreshControl,
} from "react-native";
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { API_URL, STORAGE_KEYS } from "../../constants/config";

type EmployeeRow = {
  EMP_ID: string;
  EMPNAME: string;
  EMPFNAME: string;
  EMPDESG: string;
  EMPPROFILEPHOTO: string | null;
  todayStatus: "P" | "A" | null;
  markedAt: string | null;
  location: string | null;
};

export default function SupervisorHomeScreen() {
  const router = useRouter();
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [supervisorName, setSupervisorName] = useState("");

  // Absent confirmation modal
  const [absentModal, setAbsentModal] = useState(false);
  const [pendingAbsent, setPendingAbsent] = useState<EmployeeRow | null>(null);
  const [marking, setMarking] = useState(false);

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  useEffect(() => {
    loadSupervisor();
    fetchAttendance();
  }, []);

  const loadSupervisor = async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.EMPLOYEE);
    if (raw) {
      const emp = JSON.parse(raw);
      setSupervisorName(emp.EMPNAME);
    }
  };

  const fetchAttendance = async () => {
    try {
      const res = await fetch(`${API_URL}/attendance/today`);
      const data = await res.json();
      if (data.success) {
        const mapped = data.data.map((emp: any) => ({
          ...emp,
          todayStatus: emp.todayAttendance?.STATUS ?? null,
          markedAt: emp.todayAttendance?.CREATEDAT ?? null,
          location: emp.todayAttendance?.LOCATION ?? null,
        }));
        setEmployees(mapped);
      }
    } catch {
      Alert.alert("Error", "Failed to load attendance data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };
  const handlePresentPress = (emp: EmployeeRow) => {
    // Navigate to camera screen with empId
    router.push({
      pathname: "/camera/mark",
      params: { empId: emp.EMP_ID, empName: `${emp.EMPNAME} ${emp.EMPFNAME}` },
    });
  };

  const handleAbsentPress = (emp: EmployeeRow) => {
    setPendingAbsent(emp);
    setAbsentModal(true);
  };

  const confirmAbsent = async () => {
    if (!pendingAbsent) return;
    setMarking(true);
    try {
      await new Promise<void>((resolve, reject) => {
        const formData = new FormData();
        formData.append("empId", pendingAbsent.EMP_ID);
        formData.append("status", "A");

        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${API_URL}/attendance/mark`);
        xhr.setRequestHeader("Accept", "application/json");

        xhr.onload = () => {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) {
            setEmployees((prev) =>
              prev.map((e) =>
                e.EMP_ID === pendingAbsent.EMP_ID
                  ? { ...e, todayStatus: "A" }
                  : e,
              ),
            );
            setAbsentModal(false);
            setPendingAbsent(null);
            resolve();
          } else {
            Alert.alert("Error", data.message || "Failed to mark absent");
            reject(new Error(data.message));
          }
        };

        xhr.onerror = () => reject(new Error("Network error"));
        xhr.send(formData);
      });
    } catch {
      Alert.alert("Error", "Something went wrong");
    } finally {
      setMarking(false);
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

  const present = employees.filter((e) => e.todayStatus === "P").length;
  const absent = employees.filter((e) => e.todayStatus === "A").length;
  const unmarked = employees.filter((e) => !e.todayStatus).length;

  const renderEmployee = ({ item }: { item: EmployeeRow }) => {
    const initials = `${item.EMPNAME[0]}${item.EMPFNAME[0]}`.toUpperCase();
    const marked = !!item.todayStatus;

    return (
      <View style={[styles.card, marked && styles.cardMarked]}>
        <View style={styles.cardLeft}>
          <View
            style={[
              styles.avatar,
              item.todayStatus === "P" && styles.avatarP,
              item.todayStatus === "A" && styles.avatarA,
            ]}
          >
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View>
            <Text style={styles.empName}>
              {item.EMPNAME} {item.EMPFNAME}
            </Text>
            <Text style={styles.empDesg}>{item.EMPDESG}</Text>
            {item.todayStatus && (
              <View>
                <View
                  style={[
                    styles.statusBadge,
                    item.todayStatus === "P" ? styles.badgeP : styles.badgeA,
                  ]}
                >
                  <Text style={styles.statusBadgeText}>
                    {item.todayStatus === "P" ? "✓ Present" : "✗ Absent"}
                  </Text>
                </View>
                {item.markedAt && (
                  <Text style={styles.markedAtText}>
                    {new Date(item.markedAt).toLocaleTimeString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {item.location ? `  •  ${item.location}` : ""}
                  </Text>
                )}
              </View>
            )}
          </View>
        </View>

        {!marked && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.btnPresent}
              onPress={() => handlePresentPress(item)}
            >
              <Text style={styles.btnPresentText}>P</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.btnAbsent}
              onPress={() => handleAbsentPress(item)}
            >
              <Text style={styles.btnAbsentText}>A</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Good morning,</Text>
          <Text style={styles.supervisorName}>{supervisorName}</Text>
          <Text style={styles.dateText}>{today}</Text>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => router.push("/supervisor/report")}
          >
            <Ionicons name="document-text-outline" size={20} color="#E8A020" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.iconBtn} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={20} color="#555" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <StatCard label="Present" value={present} color="#22C55E" />
        <StatCard label="Absent" value={absent} color="#EF4444" />
        <StatCard label="Pending" value={unmarked} color="#E8A020" />
      </View>

      {/* List */}
      {loading ? (
        <ActivityIndicator
          size="large"
          color="#E8A020"
          style={{ marginTop: 40 }}
        />
      ) : (
        <FlatList
          data={employees}
          keyExtractor={(item) => item.EMP_ID}
          renderItem={renderEmployee}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                fetchAttendance();
              }}
              tintColor="#E8A020"
            />
          }
          ListHeaderComponent={
            <Text style={styles.listHeader}>
              Employees ({employees.length})
            </Text>
          }
        />
      )}

      {/* Absent Confirm Modal */}
      <Modal visible={absentModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalIcon}>
              <Ionicons name="warning-outline" size={32} color="#EF4444" />
            </View>
            <Text style={styles.modalTitle}>Mark Absent?</Text>
            <Text style={styles.modalSub}>
              Mark{" "}
              <Text style={{ color: "#FFF", fontWeight: "700" }}>
                {pendingAbsent?.EMPNAME} {pendingAbsent?.EMPFNAME}
              </Text>{" "}
              as absent for today?
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => {
                  setAbsentModal(false);
                  setPendingAbsent(null);
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConfirm}
                onPress={confirmAbsent}
                disabled={marking}
              >
                {marking ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={styles.modalConfirmText}>Mark Absent</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <View style={[statStyles.card, { borderColor: color + "33" }]}>
      <Text style={[statStyles.value, { color }]}>{value}</Text>
      <Text style={statStyles.label}>{label}</Text>
    </View>
  );
}

const statStyles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: "#111",
    borderRadius: 14,
    padding: 14,
    alignItems: "center",
    borderWidth: 1,
  },
  value: { fontSize: 28, fontWeight: "800", marginBottom: 2 },
  label: { color: "#555", fontSize: 12, fontWeight: "600", letterSpacing: 0.5 },
});

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
  supervisorName: {
    color: "#FFF",
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  dateText: { color: "#444", fontSize: 13, marginTop: 4 },
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
  statsRow: {
    flexDirection: "row",
    marginHorizontal: 24,
    gap: 10,
    marginBottom: 20,
  },
  list: { paddingHorizontal: 24, paddingBottom: 32, gap: 10 },
  listHeader: {
    color: "#444",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#141414",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#1E1E1E",
  },
  cardMarked: { opacity: 0.6 },
  cardLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#222",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarP: { backgroundColor: "#14532D" },
  avatarA: { backgroundColor: "#450A0A" },
  avatarText: { color: "#888", fontSize: 14, fontWeight: "700" },
  empName: { color: "#DDD", fontSize: 14, fontWeight: "600", marginBottom: 2 },
  empDesg: { color: "#555", fontSize: 12, marginBottom: 4 },
  statusBadge: {
    alignSelf: "flex-start",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeP: { backgroundColor: "#14532D" },
  badgeA: { backgroundColor: "#450A0A" },
  statusBadgeText: { color: "#FFF", fontSize: 11, fontWeight: "700" },
  actions: { flexDirection: "row", gap: 8 },
  btnPresent: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#14532D",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#166534",
  },
  btnPresentText: { color: "#22C55E", fontSize: 16, fontWeight: "800" },
  btnAbsent: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#450A0A",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#7F1D1D",
  },
  btnAbsentText: { color: "#EF4444", fontSize: 16, fontWeight: "800" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.8)",
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  modalBox: {
    backgroundColor: "#141414",
    borderRadius: 20,
    padding: 28,
    width: "100%",
    borderWidth: 1,
    borderColor: "#222",
    alignItems: "center",
  },
  modalIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#2D0A0A",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  modalTitle: {
    color: "#FFF",
    fontSize: 20,
    fontWeight: "800",
    marginBottom: 10,
  },
  modalSub: {
    color: "#666",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 24,
  },
  modalActions: { flexDirection: "row", gap: 12, alignSelf: "stretch" },
  modalCancel: {
    flex: 1,
    backgroundColor: "#1A1A1A",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2A2A2A",
  },
  modalCancelText: { color: "#888", fontWeight: "600", fontSize: 15 },
  modalConfirm: {
    flex: 1,
    backgroundColor: "#EF4444",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  modalConfirmText: { color: "#FFF", fontWeight: "800", fontSize: 15 },
  markedAtText: { color: "#444", fontSize: 11, marginTop: 3 },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#1A1A1A",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#222",
  },
});
