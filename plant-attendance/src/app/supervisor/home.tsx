import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Modal,
  RefreshControl,
} from "react-native";
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { API_URL, STORAGE_KEYS } from "../../constants/config";
import WithDrawer, { MenuButton } from "@/components/withDrawer";
import { C } from "../../constants/theme";

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
    if (raw) setSupervisorName(JSON.parse(raw).EMPNAME);
  };

  const fetchAttendance = async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.EMPLOYEE);
      if (!raw) return;
      const { EMP_ID } = JSON.parse(raw);

      const res = await fetch(
        `${API_URL}/attendance/today?supervisorId=${EMP_ID}`,
      );
      const data = await res.json();
      if (data.success) {
        setEmployees(
          data.data.map((emp: any) => ({
            ...emp,
            todayStatus: emp.todayAttendance?.STATUS ?? null,
            markedAt: emp.todayAttendance?.CREATEDAT ?? null,
            location: emp.todayAttendance?.LOCATION ?? null,
          })),
        );
      }
    } catch {
      Alert.alert("Error", "Failed to load attendance data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const confirmAbsent = async () => {
    if (!pendingAbsent) return;
    setMarking(true);
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.EMPLOYEE);
      const supervisorEmpId = raw ? JSON.parse(raw).EMP_ID : null;

      const fd = new FormData();
      fd.append("empId", pendingAbsent.EMP_ID);
      fd.append("status", "A");
      if (supervisorEmpId) fd.append("markedBy", supervisorEmpId); // ← was missing

      const res = await fetch(`${API_URL}/attendance/mark`, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: fd,
      });
      const data = await res.json();
      if (res.ok) {
        setEmployees((prev) =>
          prev.map((e) =>
            e.EMP_ID === pendingAbsent.EMP_ID ? { ...e, todayStatus: "A" } : e,
          ),
        );
        setAbsentModal(false);
        setPendingAbsent(null);
      } else {
        Alert.alert("Error", data.message || "Failed");
      }
    } catch {
      Alert.alert("Error", "Something went wrong");
    } finally {
      setMarking(false);
    }
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
            <Text
              style={[
                styles.avatarText,
                !!item.todayStatus && styles.avatarTextMarked,
              ]}
            >
              {initials}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
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
                  <Text
                    style={[
                      styles.statusBadgeText,
                      item.todayStatus === "P"
                        ? styles.badgeTextP
                        : styles.badgeTextA,
                    ]}
                  >
                    {item.todayStatus === "P" ? "✓ Present" : "✗ Absent"}
                  </Text>
                </View>
                {item.markedAt && (
                  <Text style={styles.markedAtText}>
                    {new Date(item.markedAt).toLocaleTimeString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {item.location ? `  ·  ${item.location}` : ""}
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
              onPress={() =>
                router.push({
                  pathname: "/camera/mark",
                  params: {
                    empId: item.EMP_ID,
                    empName: `${item.EMPNAME} ${item.EMPFNAME}`,
                  },
                })
              }
            >
              <Text style={styles.btnPresentText}>P</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.btnAbsent}
              onPress={() => {
                setPendingAbsent(item);
                setAbsentModal(true);
              }}
            >
              <Text style={styles.btnAbsentText}>A</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <WithDrawer>
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <MenuButton />
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>Good morning,</Text>
            <Text style={styles.supervisorName}>{supervisorName}</Text>
            <Text style={styles.dateText}>{today}</Text>
          </View>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => router.push("/supervisor/report")}
          >
            <Ionicons
              name="document-text-outline"
              size={20}
              color={C.primary}
            />
          </TouchableOpacity>
        </View>

        <View style={styles.statsRow}>
          <StatCard
            label="Present"
            value={present}
            color={C.green}
            bg={C.greenBg}
            border={C.greenLight}
          />
          <StatCard
            label="Absent"
            value={absent}
            color={C.red}
            bg={C.redBg}
            border={C.redLight}
          />
          <StatCard
            label="Pending"
            value={unmarked}
            color={C.amber}
            bg={C.amberBg}
            border={C.amberLight}
          />
        </View>

        {loading ? (
          <ActivityIndicator
            size="large"
            color={C.primary}
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
                tintColor={C.primary}
              />
            }
            ListHeaderComponent={
              <Text style={styles.listHeader}>
                Employees ({employees.length})
              </Text>
            }
          />
        )}

        <Modal visible={absentModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalBox}>
              <View style={styles.modalIcon}>
                <Ionicons name="warning-outline" size={32} color={C.red} />
              </View>
              <Text style={styles.modalTitle}>Mark Absent?</Text>
              <Text style={styles.modalSub}>
                Mark{" "}
                <Text style={{ color: C.textPrimary, fontWeight: "700" }}>
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
                    <ActivityIndicator color={C.textInverse} size="small" />
                  ) : (
                    <Text style={styles.modalConfirmText}>Mark Absent</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </WithDrawer>
  );
}

function StatCard({
  label,
  value,
  color,
  bg,
  border,
}: {
  label: string;
  value: number;
  color: string;
  bg: string;
  border: string;
}) {
  return (
    <View
      style={[statStyles.card, { backgroundColor: bg, borderColor: border }]}
    >
      <Text style={[statStyles.value, { color }]}>{value}</Text>
      <Text style={statStyles.label}>{label}</Text>
    </View>
  );
}
const statStyles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 14,
    padding: 14,
    alignItems: "center",
    borderWidth: 1,
  },
  value: { fontSize: 28, fontWeight: "800", marginBottom: 2 },
  label: {
    color: C.textSecondary,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.pageBg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
  },
  greeting: { color: C.textMuted, fontSize: 13, marginBottom: 1 },
  supervisorName: {
    color: C.textPrimary,
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  dateText: { color: C.textMuted, fontSize: 12, marginTop: 3 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.primaryLight,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.primaryMuted,
  },
  statsRow: {
    flexDirection: "row",
    marginHorizontal: 20,
    gap: 10,
    marginBottom: 20,
  },
  list: { paddingHorizontal: 20, paddingBottom: 32, gap: 10 },
  listHeader: {
    color: C.textMuted,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: C.cardBg,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  cardMarked: { opacity: 0.7, backgroundColor: C.inputBg },
  cardLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.inputBg,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarP: { backgroundColor: C.greenLight },
  avatarA: { backgroundColor: C.redLight },
  avatarText: { color: C.textSecondary, fontSize: 14, fontWeight: "700" },
  avatarTextMarked: { color: C.textPrimary },
  empName: {
    color: C.textPrimary,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 2,
  },
  empDesg: { color: C.textMuted, fontSize: 12, marginBottom: 4 },
  statusBadge: {
    alignSelf: "flex-start",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginBottom: 2,
  },
  badgeP: { backgroundColor: C.greenLight },
  badgeA: { backgroundColor: C.redLight },
  statusBadgeText: { fontSize: 11, fontWeight: "700" },
  badgeTextP: { color: C.green },
  badgeTextA: { color: C.red },
  markedAtText: { color: C.textMuted, fontSize: 11 },
  actions: { flexDirection: "row", gap: 8 },
  btnPresent: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: C.greenBg,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.greenLight,
  },
  btnPresentText: { color: C.green, fontSize: 15, fontWeight: "800" },
  btnAbsent: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: C.redBg,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.redLight,
  },
  btnAbsentText: { color: C.red, fontSize: 15, fontWeight: "800" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  modalBox: {
    backgroundColor: C.cardBg,
    borderRadius: 20,
    padding: 28,
    width: "100%",
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 12,
  },
  modalIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: C.redBg,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  modalTitle: {
    color: C.textPrimary,
    fontSize: 20,
    fontWeight: "800",
    marginBottom: 10,
  },
  modalSub: {
    color: C.textSecondary,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 24,
  },
  modalActions: { flexDirection: "row", gap: 12, alignSelf: "stretch" },
  modalCancel: {
    flex: 1,
    backgroundColor: C.inputBg,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.border,
  },
  modalCancelText: { color: C.textSecondary, fontWeight: "600", fontSize: 15 },
  modalConfirm: {
    flex: 1,
    backgroundColor: C.red,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  modalConfirmText: { color: C.textInverse, fontWeight: "800", fontSize: 15 },
});
