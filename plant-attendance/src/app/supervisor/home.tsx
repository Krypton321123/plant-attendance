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
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { API_URL, STORAGE_KEYS } from "../../constants/config";
import WithDrawer, { MenuButton } from "@/components/withDrawer";
import { C } from "../../constants/theme";

// ─── Types ────────────────────────────────────────────────────────────────────

type OtStatus = "OT" | "HALF_OT" | "NO_OT";

type ShiftRecord = {
  STATUS:    "P" | "A";
  CREATEDAT: string;
  LOCATION:  string | null;
  SHIFT:     "DAY" | "NIGHT";
  OT_STATUS: OtStatus | null;
} | null;

type SelfAttendance = {
  dayRecord:            ShiftRecord;
  nightRecord:          ShiftRecord;
  activeRecord:         ShiftRecord;
  isCurrentShiftMarked: boolean;
};

type EmployeeRow = {
  EMP_ID:             string;
  EMPNAME:            string;
  EMPFNAME:           string;
  EMPDESG:            string;
  EMPPROFILEPHOTO:    string | null;
  dayAttendance:      ShiftRecord;
  nightAttendance:    ShiftRecord;
  currentShiftMarked: boolean;
  currentShift:       "DAY" | "NIGHT";
};

// ─── Shift helper ─────────────────────────────────────────────────────────────

function getShiftFromClock(): "DAY" | "NIGHT" {
  return new Date().getHours() >= 20 ? "NIGHT" : "DAY";
}

// ─── OT options config ────────────────────────────────────────────────────────

const OT_OPTIONS: {
  value:  OtStatus;
  label:  string;
  color:  string;
  bg:     string;
  border: string;
}[] = [
  { value: "OT",      label: "OT",    color: "#7C3AED", bg: "#EDE9FE", border: "#C4B5FD" },
  { value: "HALF_OT", label: "½ OT",  color: C.amber,  bg: C.amberBg, border: C.amberLight },
  { value: "NO_OT",   label: "No OT", color: C.textMuted, bg: C.inputBg, border: C.border },
];

// ─── OtSelector sub-component ────────────────────────────────────────────────
// Rendered inside each Present employee card.
// - If OT_STATUS is null  → show 3 tappable chips.
// - If OT_STATUS is set   → show a locked read-only badge (no re-selection).

type OtSelectorProps = {
  empId:        string;
  shift:        "DAY" | "NIGHT";
  currentValue: OtStatus | null;
  onSaved:      () => void;  // triggers a silent data reload after save
};

function OtSelector({ empId, shift, currentValue, onSaved }: OtSelectorProps) {
  const [saving, setSaving] = useState(false);

  // Already locked — read-only badge
  if (currentValue !== null) {
    const opt = OT_OPTIONS.find((o) => o.value === currentValue)!;
    return (
      <View
        style={[
          otStyles.lockedBadge,
          { backgroundColor: opt.bg, borderColor: opt.border },
        ]}
      >
        <Ionicons name="lock-closed-outline" size={9} color={opt.color} />
        <Text style={[otStyles.lockedText, { color: opt.color }]}>
          {opt.label}
        </Text>
      </View>
    );
  }

  const handleSelect = async (value: OtStatus) => {
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/attendance/ot-status`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ empId, shift, otStatus: value }),
      });
      const data = await res.json();
      if (res.ok) {
        onSaved(); // silent refresh
      } else {
        Alert.alert("Error", data.message || "Could not save OT status");
      }
    } catch {
      Alert.alert("Error", "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={otStyles.row}>
      {saving ? (
        <ActivityIndicator size="small" color={C.primary} />
      ) : (
        OT_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.value}
            style={[
              otStyles.chip,
              { backgroundColor: opt.bg, borderColor: opt.border },
            ]}
            onPress={() => handleSelect(opt.value)}
            activeOpacity={0.7}
          >
            <Text style={[otStyles.chipText, { color: opt.color }]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))
      )}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function SupervisorHomeScreen() {
  const router = useRouter();
  const [supervisor,        setSupervisor]       = useState<any>(null);
  const [employees,         setEmployees]        = useState<EmployeeRow[]>([]);
  const [selfAttendance,    setSelfAttendance]   = useState<SelfAttendance | null>(null);
  const [loading,           setLoading]          = useState(true);
  const [refreshing,        setRefreshing]       = useState(false);
  const [currentShift,      setCurrentShift]     = useState<"DAY" | "NIGHT">(getShiftFromClock());
  const [absentModal,       setAbsentModal]      = useState(false);
  const [pendingAbsent,     setPendingAbsent]    = useState<EmployeeRow | null>(null);
  const [marking,           setMarking]          = useState(false);
  const [markingSelfAbsent, setMarkingSelfAbsent]= useState(false);

  const lastShiftRef = useRef<"DAY" | "NIGHT">(getShiftFromClock());

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day:     "numeric",
    month:   "long",
  });

  // ── Live shift clock ───────────────────────────────────────────────────────
  useEffect(() => {
    const tick = setInterval(() => {
      const newShift = getShiftFromClock();
      if (newShift !== lastShiftRef.current) {
        lastShiftRef.current = newShift;
        setCurrentShift(newShift);
        loadData(true);
      }
    }, 60_000);
    return () => clearInterval(tick);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData(true);
    }, [])
  );

  const loadData = async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.EMPLOYEE);
      if (!raw) return;
      const sup = JSON.parse(raw);
      setSupervisor(sup);

      const res  = await fetch(`${API_URL}/attendance/today?supervisorId=${sup.EMP_ID}`);
      const data = await res.json();
      if (data.success) {
        setEmployees(data.data);
        setSelfAttendance(data.selfAttendance ?? null);
      }
    } catch {
      Alert.alert("Error", "Failed to load attendance data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // ── Mark employee absent ──────────────────────────────────────────────────
  const confirmAbsent = async () => {
    if (!pendingAbsent || !supervisor) return;
    setMarking(true);
    try {
      const fd = new FormData();
      fd.append("empId",    pendingAbsent.EMP_ID);
      fd.append("status",   "A");
      fd.append("markedBy", supervisor.EMP_ID);

      const res  = await fetch(`${API_URL}/attendance/mark`, {
        method:  "POST",
        headers: { Accept: "application/json" },
        body:    fd,
      });
      const data = await res.json();

      if (res.ok) {
        await loadData(true);
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

  // ── Mark self absent ──────────────────────────────────────────────────────
  const confirmSelfAbsent = async () => {
    if (!supervisor) return;
    setMarkingSelfAbsent(true);
    try {
      const fd = new FormData();
      fd.append("empId",  supervisor.EMP_ID);
      fd.append("status", "A");

      const res  = await fetch(`${API_URL}/attendance/mark`, {
        method:  "POST",
        headers: { Accept: "application/json" },
        body:    fd,
      });
      const data = await res.json();

      if (res.ok) {
        await loadData();
      } else {
        Alert.alert("Error", data.message || "Failed");
      }
    } catch {
      Alert.alert("Error", "Something went wrong");
    } finally {
      setMarkingSelfAbsent(false);
    }
  };

  // ── Stats ─────────────────────────────────────────────────────────────────
  const present  = employees.filter(
    (e) =>
      e.currentShiftMarked &&
      (currentShift === "DAY"
        ? e.dayAttendance?.STATUS === "P"
        : e.nightAttendance?.STATUS === "P")
  ).length;

  const absent   = employees.filter(
    (e) =>
      e.currentShiftMarked &&
      (currentShift === "DAY"
        ? e.dayAttendance?.STATUS === "A"
        : e.nightAttendance?.STATUS === "A")
  ).length;

  const unmarked = employees.filter((e) => !e.currentShiftMarked).length;

  // ── Self-attendance card ──────────────────────────────────────────────────
  const SelfAttendanceCard = () => {
    if (!selfAttendance) return null;
    const { isCurrentShiftMarked, activeRecord } = selfAttendance;
    const isPresent  = activeRecord?.STATUS === "P";
    const markedTime = activeRecord?.CREATEDAT
      ? new Date(activeRecord.CREATEDAT).toLocaleTimeString("en-IN", {
          hour: "2-digit", minute: "2-digit",
        })
      : null;

    return (
      <View style={selfStyles.card}>
        <View style={selfStyles.labelRow}>
          <Ionicons name="person-circle-outline" size={15} color={C.primary} />
          <Text style={selfStyles.label}>YOUR ATTENDANCE</Text>
          <View
            style={[
              selfStyles.shiftPill,
              currentShift === "NIGHT" && selfStyles.shiftPillNight,
            ]}
          >
            <Ionicons
              name={currentShift === "DAY" ? "sunny-outline" : "moon-outline"}
              size={10}
              color={currentShift === "DAY" ? C.amber : "#818CF8"}
            />
            <Text
              style={[
                selfStyles.shiftPillText,
                currentShift === "NIGHT" && selfStyles.shiftPillTextNight,
              ]}
            >
              {currentShift}
            </Text>
          </View>
        </View>

        {isCurrentShiftMarked ? (
          <View>
            <View style={selfStyles.markedRow}>
              <View
                style={[
                  selfStyles.statusDot,
                  isPresent ? selfStyles.dotP : selfStyles.dotA,
                ]}
              />
              <Text
                style={[
                  selfStyles.statusText,
                  { color: isPresent ? C.green : C.red },
                ]}
              >
                {isPresent ? "Present" : "Absent"}
              </Text>
              {markedTime && (
                <Text style={selfStyles.timeText}>· {markedTime}</Text>
              )}
              {activeRecord?.LOCATION && (
                <Text style={selfStyles.timeText} numberOfLines={1}>
                  · {activeRecord.LOCATION}
                </Text>
              )}
            </View>

            {/* OT selector for self — only when Present */}
            {isPresent && supervisor && (
              <View style={{ marginTop: 10 }}>
                <Text style={selfStyles.otLabel}>OT Status</Text>
                <OtSelector
                  empId={supervisor.EMP_ID}
                  shift={currentShift}
                  currentValue={activeRecord?.OT_STATUS ?? null}
                  onSaved={() => loadData(false)}
                />
              </View>
            )}
          </View>
        ) : (
          <View style={selfStyles.actionRow}>
            <Text style={selfStyles.notMarkedText}>Not marked yet</Text>
            <View style={selfStyles.btnRow}>
              <TouchableOpacity
                style={selfStyles.btnPresent}
                onPress={() =>
                  router.push({
                    pathname: "/camera/mark",
                    params: {
                      empId:   supervisor.EMP_ID,
                      empName: `${supervisor.EMPNAME} ${supervisor.EMPFNAME}`,
                      isSelf:  "true",
                    },
                  })
                }
              >
                <Ionicons name="camera-outline" size={14} color={C.textInverse} />
                <Text style={selfStyles.btnPresentText}>Mark Present</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={selfStyles.btnAbsent}
                disabled={markingSelfAbsent}
                onPress={() =>
                  Alert.alert(
                    "Mark Yourself Absent",
                    `Mark yourself absent for the ${currentShift} shift?`,
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text:    "Mark Absent",
                        style:   "destructive",
                        onPress: confirmSelfAbsent,
                      },
                    ]
                  )
                }
              >
                {markingSelfAbsent ? (
                  <ActivityIndicator color={C.red} size="small" />
                ) : (
                  <Text style={selfStyles.btnAbsentText}>Absent</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Other-shift strip */}
        {currentShift === "NIGHT" && selfAttendance.dayRecord && (
          <View style={selfStyles.otherShiftRow}>
            <Ionicons name="sunny-outline" size={11} color={C.amber} />
            <Text style={selfStyles.otherShiftText}>
              Day:{" "}
              <Text
                style={{
                  color:
                    selfAttendance.dayRecord.STATUS === "P" ? C.green : C.red,
                  fontWeight: "700",
                }}
              >
                {selfAttendance.dayRecord.STATUS === "P" ? "Present" : "Absent"}
              </Text>
            </Text>
          </View>
        )}
        {currentShift === "DAY" && selfAttendance.nightRecord && (
          <View
            style={[selfStyles.otherShiftRow, { borderColor: "#C7D2FE" }]}
          >
            <Ionicons name="moon-outline" size={11} color="#818CF8" />
            <Text style={selfStyles.otherShiftText}>
              Night:{" "}
              <Text
                style={{
                  color:
                    selfAttendance.nightRecord.STATUS === "P"
                      ? C.green
                      : C.red,
                  fontWeight: "700",
                }}
              >
                {selfAttendance.nightRecord.STATUS === "P"
                  ? "Present"
                  : "Absent"}
              </Text>
            </Text>
          </View>
        )}
      </View>
    );
  };

  // ── Employee card ─────────────────────────────────────────────────────────
  const renderEmployee = ({ item }: { item: EmployeeRow }) => {
    const initials     = `${item.EMPNAME[0]}${item.EMPFNAME[0]}`.toUpperCase();
    const activeRecord = currentShift === "DAY" ? item.dayAttendance : item.nightAttendance;
    const otherRecord  = currentShift === "DAY" ? item.nightAttendance : item.dayAttendance;
    const isMarked     = item.currentShiftMarked;
    const isPresent    = activeRecord?.STATUS === "P";

    return (
      <View style={[styles.card, isMarked && styles.cardMarked]}>
        <View style={styles.cardLeft}>
          <View
            style={[
              styles.avatar,
              activeRecord?.STATUS === "P" && styles.avatarP,
              activeRecord?.STATUS === "A" && styles.avatarA,
            ]}
          >
            <Text
              style={[
                styles.avatarText,
                isMarked && styles.avatarTextMarked,
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

            {isMarked && activeRecord && (
              <View>
                <View
                  style={[
                    styles.statusBadge,
                    isPresent ? styles.badgeP : styles.badgeA,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusBadgeText,
                      isPresent ? styles.badgeTextP : styles.badgeTextA,
                    ]}
                  >
                    {isPresent ? "✓ Present" : "✗ Absent"}
                  </Text>
                </View>

                {activeRecord.CREATEDAT && (
                  <Text style={styles.markedAtText}>
                    {new Date(activeRecord.CREATEDAT).toLocaleTimeString(
                      "en-IN",
                      { hour: "2-digit", minute: "2-digit" }
                    )}
                    {activeRecord.LOCATION
                      ? `  ·  ${activeRecord.LOCATION}`
                      : ""}
                  </Text>
                )}

                {/* ── OT selector — only for Present records ── */}
                {isPresent && (
                  <OtSelector
                    empId={item.EMP_ID}
                    shift={currentShift}
                    currentValue={activeRecord.OT_STATUS}
                    onSaved={() => loadData(false)}
                  />
                )}
              </View>
            )}

            {otherRecord && (
              <View
                style={[
                  styles.otherShiftPill,
                  currentShift === "NIGHT" && styles.otherShiftPillNight,
                ]}
              >
                <Ionicons
                  name={
                    currentShift === "NIGHT"
                      ? "sunny-outline"
                      : "moon-outline"
                  }
                  size={10}
                  color={currentShift === "NIGHT" ? C.amber : "#818CF8"}
                />
                <Text
                  style={[
                    styles.otherShiftPillText,
                    currentShift === "NIGHT" &&
                      styles.otherShiftPillTextNight,
                  ]}
                >
                  {currentShift === "NIGHT" ? "Day" : "Night"}:{" "}
                  <Text
                    style={{
                      fontWeight: "700",
                      color:
                        otherRecord.STATUS === "P" ? C.green : C.red,
                    }}
                  >
                    {otherRecord.STATUS === "P" ? "P" : "A"}
                  </Text>
                </Text>
              </View>
            )}
          </View>
        </View>

        {!isMarked && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.btnPresent}
              onPress={() =>
                router.push({
                  pathname: "/camera/mark",
                  params: {
                    empId:    item.EMP_ID,
                    empName:  `${item.EMPNAME} ${item.EMPFNAME}`,
                    markedBy: supervisor?.EMP_ID,
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

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <WithDrawer>
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        {/* Header */}
        <View style={styles.header}>
          <MenuButton />
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>Good morning,</Text>
            <Text style={styles.supervisorName}>{supervisor?.EMPNAME}</Text>
            <Text style={styles.dateText}>{today}</Text>
          </View>
          <View
            style={[
              styles.shiftChip,
              currentShift === "NIGHT" && styles.shiftChipNight,
            ]}
          >
            <Ionicons
              name={
                currentShift === "DAY" ? "sunny-outline" : "moon-outline"
              }
              size={13}
              color={currentShift === "DAY" ? C.amber : "#818CF8"}
            />
            <Text
              style={[
                styles.shiftChipText,
                currentShift === "NIGHT" && styles.shiftChipTextNight,
              ]}
            >
              {currentShift}
            </Text>
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

        {/* Stats */}
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
                  loadData();
                }}
                tintColor={C.primary}
              />
            }
            ListHeaderComponent={
              <>
                <SelfAttendanceCard />
                <Text style={styles.listHeader}>
                  Employees ({employees.length}) · {currentShift} Shift
                </Text>
              </>
            }
          />
        )}

        {/* Absent confirmation modal */}
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
                absent for the{" "}
                <Text
                  style={{
                    fontWeight: "700",
                    color: currentShift === "DAY" ? C.amber : "#818CF8",
                  }}
                >
                  {currentShift}
                </Text>{" "}
                shift?
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

// ─── StatCard ─────────────────────────────────────────────────────────────────

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
      style={[
        statStyles.card,
        { backgroundColor: bg, borderColor: border },
      ]}
    >
      <Text style={[statStyles.value, { color }]}>{value}</Text>
      <Text style={statStyles.label}>{label}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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

const otStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 6,
    marginTop: 6,
    flexWrap: "wrap",
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 11,
    fontWeight: "700",
  },
  lockedBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 6,
  },
  lockedText: {
    fontSize: 11,
    fontWeight: "800",
  },
});

const selfStyles = StyleSheet.create({
  card: {
    backgroundColor: C.cardBg,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: C.primaryMuted,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 12,
  },
  label: {
    color: C.textMuted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    flex: 1,
  },
  otLabel: {
    color: C.textMuted,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  shiftPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: C.amberBg,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: C.amberLight,
  },
  shiftPillNight:     { backgroundColor: "#EEF2FF", borderColor: "#C7D2FE" },
  shiftPillText:      { color: C.amber, fontSize: 10, fontWeight: "800" },
  shiftPillTextNight: { color: "#818CF8" },
  markedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  statusDot:  { width: 8, height: 8, borderRadius: 4 },
  dotP:       { backgroundColor: C.green },
  dotA:       { backgroundColor: C.red },
  statusText: { fontSize: 14, fontWeight: "700" },
  timeText:   { color: C.textMuted, fontSize: 13, flex: 1 },
  actionRow:  { gap: 10 },
  notMarkedText: { color: C.textMuted, fontSize: 12, marginBottom: 8 },
  btnRow:     { flexDirection: "row", gap: 10 },
  btnPresent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 12,
    gap: 6,
  },
  btnPresentText: { color: C.textInverse, fontSize: 13, fontWeight: "800" },
  btnAbsent: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: C.redBg,
    borderWidth: 1,
    borderColor: C.redLight,
    alignItems: "center",
    justifyContent: "center",
  },
  btnAbsentText: { color: C.red, fontSize: 13, fontWeight: "700" },
  otherShiftRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: C.amberLight,
  },
  otherShiftText: { color: C.textSecondary, fontSize: 12 },
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
  greeting:       { color: C.textMuted,   fontSize: 13, marginBottom: 1 },
  supervisorName: { color: C.textPrimary, fontSize: 22, fontWeight: "800", letterSpacing: -0.3 },
  dateText:       { color: C.textMuted,   fontSize: 12, marginTop: 3 },
  shiftChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: C.amberBg,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: C.amberLight,
  },
  shiftChipNight:     { backgroundColor: "#EEF2FF", borderColor: "#C7D2FE" },
  shiftChipText:      { color: C.amber,   fontSize: 11, fontWeight: "800" },
  shiftChipTextNight: { color: "#818CF8" },
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
  list:       { paddingHorizontal: 20, paddingBottom: 32, gap: 10 },
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
  cardLeft:   { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.inputBg,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarP:          { backgroundColor: C.greenLight },
  avatarA:          { backgroundColor: C.redLight },
  avatarText:       { color: C.textSecondary, fontSize: 14, fontWeight: "700" },
  avatarTextMarked: { color: C.textPrimary },
  empName:  { color: C.textPrimary, fontSize: 14, fontWeight: "600", marginBottom: 2 },
  empDesg:  { color: C.textMuted,   fontSize: 12, marginBottom: 4 },
  statusBadge: {
    alignSelf: "flex-start",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginBottom: 2,
  },
  badgeP:          { backgroundColor: C.greenLight },
  badgeA:          { backgroundColor: C.redLight },
  statusBadgeText: { fontSize: 11, fontWeight: "700" },
  badgeTextP:      { color: C.green },
  badgeTextA:      { color: C.red },
  markedAtText:    { color: C.textMuted, fontSize: 11 },
  otherShiftPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: C.amberBg,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 4,
    borderWidth: 1,
    borderColor: C.amberLight,
  },
  otherShiftPillNight:     { backgroundColor: "#EEF2FF", borderColor: "#C7D2FE" },
  otherShiftPillText:      { color: C.amber,  fontSize: 10 },
  otherShiftPillTextNight: { color: "#818CF8" },
  actions:    { flexDirection: "row", gap: 8 },
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
  modalTitle:   { color: C.textPrimary,   fontSize: 20, fontWeight: "800", marginBottom: 10 },
  modalSub:     { color: C.textSecondary, fontSize: 14, textAlign: "center", lineHeight: 20, marginBottom: 24 },
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
  modalCancelText:  { color: C.textSecondary, fontWeight: "600", fontSize: 15 },
  modalConfirm:     { flex: 1, backgroundColor: C.red, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  modalConfirmText: { color: C.textInverse, fontWeight: "800", fontSize: 15 },
});