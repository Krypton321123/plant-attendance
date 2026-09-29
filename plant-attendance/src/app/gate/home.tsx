import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, FlatList, Alert, Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCallback, useState } from "react";
import { useRouter, useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { API_URL, STORAGE_KEYS } from "../../constants/config";
import { C } from "../../constants/theme";

type VisitorLogRecord = {
  LOG_ID: string;
  ENTRY_TYPE: "PERSON" | "VEHICLE";
  NAME: string;
  VEHICLE_NO: string | null;
  PURPOSE: string;
  PHOTO: string | null;
  ENTRY_AT: string;
  EXIT_AT: string | null;
  LOGGED_BY: string;
  loggedBy?: { EMPNAME: string };
};

export default function GateHomeScreen() {
  const router = useRouter();
  const [employee,  setEmployee]  = useState<any>(null);
  const [records,   setRecords]   = useState<VisitorLogRecord[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [exitingId, setExitingId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => { loadData(); }, [])
  );

  const loadData = async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.EMPLOYEE);
      if (raw) setEmployee(JSON.parse(raw));

      const res  = await fetch(`${API_URL}/gate/active`);
      const data = await res.json();
      if (data.success) setRecords(data.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const confirmExit = (record: VisitorLogRecord) => {
    Alert.alert(
      "Mark Exit",
      `Mark ${record.NAME} as exited?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Mark Exit", style: "destructive", onPress: () => markExit(record) },
      ]
    );
  };

  const markExit = async (record: VisitorLogRecord) => {
    if (!employee) return;
    setExitingId(record.LOG_ID);
    try {
      const res  = await fetch(`${API_URL}/gate/exit`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ logId: record.LOG_ID, exitLoggedBy: employee.EMP_ID }),
      });
      const data = await res.json();

      if (res.ok) {
        await loadData();
      } else if (res.status === 409) {
        // Shared list across guards — another guard's device may have
        // already marked this exit a moment ago. Refresh rather than error.
        Alert.alert("Already Handled", "This entry's exit was already marked.");
        await loadData();
      } else {
        Alert.alert("Error", data.message || "Failed to mark exit");
      }
    } catch {
      Alert.alert("Error", "Something went wrong");
    } finally {
      setExitingId(null);
    }
  };

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

  const renderItem = ({ item }: { item: VisitorLogRecord }) => (
    <View style={styles.row}>
      {item.PHOTO ? (
        // Assumes UPLOADS_DIR is served statically at "/uploads" on the API
        // host (e.g. app.use('/uploads', express.static(UPLOADS_DIR))).
        // Adjust this base path if your server serves uploads differently.
        <Image source={{ uri: `${API_URL}/uploads/${item.PHOTO}` }} style={styles.rowPhoto} />
      ) : (
        <View style={styles.rowPhotoPlaceholder}>
          <Ionicons
            name={item.ENTRY_TYPE === "VEHICLE" ? "car-outline" : "person-outline"}
            size={22}
            color={C.textMuted}
          />
        </View>
      )}

      <View style={{ flex: 1 }}>
        <View style={styles.rowTopLine}>
          <Text style={styles.rowName} numberOfLines={1}>{item.NAME}</Text>
          <View style={[styles.typeBadge, item.ENTRY_TYPE === "VEHICLE" && styles.typeBadgeVehicle]}>
            <Ionicons
              name={item.ENTRY_TYPE === "VEHICLE" ? "car-outline" : "person-outline"}
              size={11}
              color={item.ENTRY_TYPE === "VEHICLE" ? "#818CF8" : C.primary}
            />
            <Text style={[styles.typeBadgeText, item.ENTRY_TYPE === "VEHICLE" && styles.typeBadgeTextVehicle]}>
              {item.ENTRY_TYPE}
            </Text>
          </View>
        </View>

        {item.VEHICLE_NO && <Text style={styles.rowMeta}>{item.VEHICLE_NO}</Text>}
        <Text style={styles.rowMeta} numberOfLines={1}>{item.PURPOSE}</Text>

        <View style={styles.rowBottomLine}>
          <Ionicons name="time-outline" size={12} color={C.textMuted} />
          <Text style={styles.rowTime}>Entered {formatTime(item.ENTRY_AT)}</Text>
          {item.loggedBy?.EMPNAME && (
            <Text style={styles.rowTime}>·  {item.loggedBy.EMPNAME}</Text>
          )}
        </View>
      </View>

      <TouchableOpacity
        style={styles.exitBtn}
        onPress={() => confirmExit(item)}
        disabled={exitingId === item.LOG_ID}
      >
        {exitingId === item.LOG_ID ? (
          <ActivityIndicator size="small" color={C.red} />
        ) : (
          <Text style={styles.exitBtnText}>Mark Exit</Text>
        )}
      </TouchableOpacity>
    </View>
  );

  if (loading) return (
    <SafeAreaView style={styles.container}>
      <ActivityIndicator size="large" color={C.primary} style={{ marginTop: 80 }} />
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={C.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Gate Entry Log</Text>
          <Text style={styles.headerSub}>{records.length} currently inside</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.newEntryBtn} onPress={() => router.push("/gate/new-entry")}>
        <Ionicons name="add-circle-outline" size={20} color={C.textInverse} />
        <Text style={styles.newEntryBtnText}>New Entry</Text>
      </TouchableOpacity>

      <FlatList
        data={records}
        keyExtractor={(item) => item.LOG_ID}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="checkmark-done-circle-outline" size={40} color={C.textMuted} />
            <Text style={styles.emptyStateText}>No one currently inside</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.pageBg },
  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.cardBg, borderWidth: 1, borderColor: C.border,
    justifyContent: "center", alignItems: "center",
  },
  headerTitle: { color: C.textPrimary, fontSize: 19, fontWeight: "800", letterSpacing: -0.3 },
  headerSub:   { color: C.textMuted, fontSize: 13, marginTop: 2 },
  newEntryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: C.primary, borderRadius: 14, paddingVertical: 15,
    marginHorizontal: 20, marginBottom: 16,
  },
  newEntryBtnText: { color: C.textInverse, fontSize: 15, fontWeight: "800" },
  listContent: { paddingHorizontal: 20, paddingBottom: 24, flexGrow: 1 },
  row: {
    flexDirection: "row", gap: 12, alignItems: "center",
    backgroundColor: C.cardBg, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    padding: 12, marginBottom: 10,
  },
  rowPhoto: { width: 48, height: 48, borderRadius: 10, backgroundColor: C.inputBg },
  rowPhotoPlaceholder: {
    width: 48, height: 48, borderRadius: 10, backgroundColor: C.inputBg,
    justifyContent: "center", alignItems: "center",
  },
  rowTopLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowName: { color: C.textPrimary, fontSize: 15, fontWeight: "700", flexShrink: 1 },
  typeBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: C.primaryLight, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  typeBadgeVehicle: { backgroundColor: "#EEF2FF" },
  typeBadgeText: { color: C.primary, fontSize: 9, fontWeight: "800", letterSpacing: 0.4 },
  typeBadgeTextVehicle: { color: "#818CF8" },
  rowMeta: { color: C.textSecondary, fontSize: 12.5, marginTop: 2 },
  rowBottomLine: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  rowTime: { color: C.textMuted, fontSize: 11.5 },
  exitBtn: {
    backgroundColor: C.redBg, borderWidth: 1, borderColor: C.redLight,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, minWidth: 84, alignItems: "center",
  },
  exitBtnText: { color: C.red, fontSize: 12.5, fontWeight: "700" },
  emptyState: { alignItems: "center", justifyContent: "center", paddingTop: 60, gap: 10 },
  emptyStateText: { color: C.textMuted, fontSize: 14, fontWeight: "500" },
});