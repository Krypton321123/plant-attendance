import {
  View, Text, FlatList, TouchableOpacity, ActivityIndicator,
  StyleSheet, Alert, RefreshControl,
} from "react-native";
import { useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { API_URL } from "../../constants/config";
import WithDrawer, { MenuButton } from "@/components/withDrawer";
import { C } from "../../constants/theme";

type Employee = {
  EMP_ID: string; EMPNAME: string; EMPFNAME: string; EMPDESG: string;
  EMPTYPE: string; STATUS: string; DEVICEID: string | null; CREATEDAT: string;
};

const SUPERVISOR_TYPES = ["SUPERVISOR", "PPSUPERVISOR", "KPSUPERVISOR"];

export default function AdminHomeScreen() {
  const router = useRouter();
  const [employees,  setEmployees]  = useState<Employee[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => { fetchEmployees(); }, []);

  const fetchEmployees = async () => {
    try {
      const res  = await fetch(`${API_URL}/employees`);
      const data = await res.json();
      if (data.success) setEmployees(data.data);
    } catch { Alert.alert("Error", "Failed to load employees"); }
    finally  { setLoading(false); setRefreshing(false); }
  };

  const toggleApproval = async (emp: Employee) => {
    const newStatus = emp.STATUS === "A" ? "NA" : "A";
    const action    = newStatus === "A" ? "approve" : "revoke access for";
    Alert.alert(
      newStatus === "A" ? "Approve Employee" : "Revoke Access",
      `Are you sure you want to ${action} ${emp.EMPNAME} ${emp.EMPFNAME}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: newStatus === "A" ? "Approve" : "Revoke",
          style: newStatus === "A" ? "default" : "destructive",
          onPress: async () => {
            setTogglingId(emp.EMP_ID);
            try {
              const res  = await fetch(`${API_URL}/employees/${emp.EMP_ID}/approve`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: newStatus }),
              });
              const data = await res.json();
              if (res.ok) setEmployees(prev => prev.map(e => e.EMP_ID === emp.EMP_ID ? { ...e, STATUS: newStatus } : e));
              else Alert.alert("Error", data.message || "Failed");
            } catch { Alert.alert("Error", "Something went wrong"); }
            finally  { setTogglingId(null); }
          },
        },
      ]
    );
  };

  const approved = employees.filter(e => e.STATUS === "A").length;
  const pending  = employees.filter(e => e.STATUS === "NA").length;

  const renderEmployee = ({ item }: { item: Employee }) => {
    const initials      = `${item.EMPNAME[0]}${item.EMPFNAME[0]}`.toUpperCase();
    const isApproved    = item.STATUS === "A";
    const isToggling    = togglingId === item.EMP_ID;
    // No device = just created, hasn't opened the app yet — cannot approve yet
    const hasNoDevice   = !item.DEVICEID;
    const isSupervisorType = SUPERVISOR_TYPES.includes(item.EMPTYPE);

    return (
      <View style={[styles.card, hasNoDevice && styles.cardNoDevice]}>
        <View style={[styles.avatar, isApproved ? styles.avatarApproved : styles.avatarPending]}>
          <Text style={[styles.avatarText, isApproved ? styles.avatarTextApproved : styles.avatarTextPending]}>
            {initials}
          </Text>
        </View>

        <View style={styles.cardInfo}>
          <Text style={styles.empName}>{item.EMPNAME} {item.EMPFNAME}</Text>
          <Text style={styles.empDesg}>{item.EMPDESG}</Text>
          <View style={styles.metaRow}>
            <View style={[
              styles.typePill,
              isSupervisorType && styles.typePillSupervisor,
              item.EMPTYPE === "ADMIN"   && styles.typePillAdmin,
              item.EMPTYPE === "OFFICE"  && styles.typePillOffice,
            ]}>
              <Text style={[
                styles.typePillText,
                isSupervisorType && styles.typePillTextSupervisor,
                item.EMPTYPE === "OFFICE" && styles.typePillTextOffice,
              ]}>
                {item.EMPTYPE}
              </Text>
            </View>

            {hasNoDevice && (
              <View style={styles.noDevicePill}>
                <Ionicons name="phone-portrait-outline" size={10} color={C.textMuted} style={{ marginRight: 3 }} />
                <Text style={styles.noDeviceText}>No device</Text>
              </View>
            )}

            <View style={[styles.statusPill, isApproved ? styles.statusPillA : styles.statusPillNA]}>
              <Text style={[styles.statusPillText, isApproved ? styles.statusPillTextA : styles.statusPillTextNA]}>
                {isApproved ? "Approved" : "Pending"}
              </Text>
            </View>
          </View>
        </View>

        {/* Approve / Revoke button — disabled when no device registered */}
        <TouchableOpacity
          style={[
            styles.approveBtn,
            isApproved ? styles.approveBtnRevoke : styles.approveBtnApprove,
            hasNoDevice && styles.approveBtnDisabled,
          ]}
          onPress={() => !hasNoDevice && toggleApproval(item)}
          disabled={isToggling || hasNoDevice}
        >
          {isToggling ? (
            <ActivityIndicator size="small" color={isApproved ? C.red : C.green} />
          ) : hasNoDevice ? (
            <Ionicons name="hourglass-outline" size={20} color={C.textMuted} />
          ) : (
            <Ionicons
              name={isApproved ? "close-circle-outline" : "checkmark-circle-outline"}
              size={22}
              color={isApproved ? C.red : C.green}
            />
          )}
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <WithDrawer>
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <MenuButton />
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Admin Panel</Text>
            <Text style={styles.headerSub}>Manage employees & approvals</Text>
          </View>
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => router.push("/supervisor/create-employee")}
          >
            <Ionicons name="person-add-outline" size={20} color={C.primary} />
          </TouchableOpacity>
        </View>

        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: C.greenBg, borderColor: C.greenLight }]}>
            <Text style={[styles.statNum, { color: C.green }]}>{approved}</Text>
            <Text style={styles.statLabel}>Approved</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: C.amberBg, borderColor: C.amberLight }]}>
            <Text style={[styles.statNum, { color: C.amber }]}>{pending}</Text>
            <Text style={styles.statLabel}>Pending</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: C.inputBg, borderColor: C.border }]}>
            <Text style={[styles.statNum, { color: C.textSecondary }]}>{employees.length}</Text>
            <Text style={styles.statLabel}>Total</Text>
          </View>
        </View>

        {loading ? (
          <ActivityIndicator size="large" color={C.primary} style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={employees}
            keyExtractor={item => item.EMP_ID}
            renderItem={renderEmployee}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => { setRefreshing(true); fetchEmployees(); }}
                tintColor={C.primary}
              />
            }
            ListHeaderComponent={
              <Text style={styles.listHeader}>All Employees ({employees.length})</Text>
            }
            ListEmptyComponent={
              <Text style={styles.emptyText}>No employees found</Text>
            }
          />
        )}
      </SafeAreaView>
    </WithDrawer>
  );
}

const styles = StyleSheet.create({
  container:              { flex: 1, backgroundColor: C.pageBg },
  header:                 { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 },
  headerTitle:            { color: C.textPrimary,   fontSize: 20, fontWeight: "800", letterSpacing: -0.3 },
  headerSub:              { color: C.textMuted,     fontSize: 13, marginTop: 2 },
  addBtn: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: C.primaryLight,
    justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: C.primaryMuted,
  },
  statsRow:               { flexDirection: "row", marginHorizontal: 20, gap: 10, marginBottom: 20 },
  statCard:               { flex: 1, borderRadius: 14, padding: 14, alignItems: "center", borderWidth: 1 },
  statNum:                { fontSize: 26, fontWeight: "800", marginBottom: 2 },
  statLabel:              { color: C.textSecondary, fontSize: 11, fontWeight: "600", letterSpacing: 0.5 },
  list:                   { paddingHorizontal: 20, paddingBottom: 32, gap: 8 },
  listHeader:             { color: C.textMuted, fontSize: 12, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 },
  emptyText:              { color: C.textMuted, textAlign: "center", marginTop: 40 },
  card: {
    flexDirection: "row", alignItems: "center", backgroundColor: C.cardBg,
    borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.border, gap: 12,
    shadowColor: "#0F172A", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  cardNoDevice:           { opacity: 0.6 },
  avatar:                 { width: 44, height: 44, borderRadius: 22, justifyContent: "center", alignItems: "center" },
  avatarApproved:         { backgroundColor: C.greenLight },
  avatarPending:          { backgroundColor: C.amberBg    },
  avatarText:             { fontSize: 14, fontWeight: "700" },
  avatarTextApproved:     { color: C.green  },
  avatarTextPending:      { color: C.amber  },
  cardInfo:               { flex: 1 },
  empName:                { color: C.textPrimary,   fontSize: 14, fontWeight: "600", marginBottom: 2 },
  empDesg:                { color: C.textMuted,     fontSize: 12, marginBottom: 6 },
  metaRow:                { flexDirection: "row", gap: 5, flexWrap: "wrap", alignItems: "center" },
  typePill:               { backgroundColor: C.inputBg, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 },
  typePillSupervisor:     { backgroundColor: C.primaryLight },
  typePillAdmin:          { backgroundColor: "#EDE9FE" },
  typePillOffice:         { backgroundColor: C.amberBg },
  typePillText:           { color: C.textMuted, fontSize: 10, fontWeight: "700", letterSpacing: 0.8 },
  typePillTextSupervisor: { color: C.primary },
  typePillTextOffice:     { color: C.amber  },
  noDevicePill:           { flexDirection: "row", alignItems: "center", backgroundColor: C.inputBg, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 },
  noDeviceText:           { color: C.textMuted, fontSize: 10, fontWeight: "600" },
  statusPill:             { borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 },
  statusPillA:            { backgroundColor: C.greenLight },
  statusPillNA:           { backgroundColor: C.amberBg   },
  statusPillText:         { fontSize: 10, fontWeight: "700" },
  statusPillTextA:        { color: C.green  },
  statusPillTextNA:       { color: C.amber  },
  approveBtn:             { width: 44, height: 44, borderRadius: 12, justifyContent: "center", alignItems: "center", borderWidth: 1 },
  approveBtnApprove:      { backgroundColor: C.greenBg, borderColor: C.greenLight },
  approveBtnRevoke:       { backgroundColor: C.redBg,   borderColor: C.redLight   },
  approveBtnDisabled:     { backgroundColor: C.inputBg, borderColor: C.border      },
});