import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useEffect, useState, useCallback, useMemo } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_URL, STORAGE_KEYS } from "../../constants/config";
import { C } from "../../constants/theme";

// ─── Types ────────────────────────────────────────────────────────────────────

type MstItem = {
  itmcd: string;
  itmnm: string;
  itmsubcat: string | null;
  pcksz: number | null;
};

type WastageRow = {
  itmcd: string;
  itmnm: string;
  itmsubcat: string | null;
  cartonWastage: string;
  pcsWastage: string;
  looseOil: string;
};

// ─── Date helpers ─────────────────────────────────────────────────────────────
// Same helpers as the filling screen — local-date (not UTC) "YYYY-MM-DD"
// key, since that's what the backend's dayRange() expects.
const toDateKey = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const addDays = (d: Date, n: number) => {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
};

const isSameDay = (a: Date, b: Date) => toDateKey(a) === toDateKey(b);

const formatDateLabel = (d: Date) => {
  const today = new Date();
  if (isSameDay(d, today)) return "Today";
  if (isSameDay(d, addDays(today, -1))) return "Yesterday";
  if (isSameDay(d, addDays(today, 1))) return "Tomorrow";
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const formatFullDateLabel = (d: Date) =>
  d.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

// ─── Date Picker Modal ────────────────────────────────────────────────────────
// Same component as the filling screen — quick-pick strip + month grid,
// built from existing primitives so no new native dependency is needed.
// Future dates beyond "Tomorrow" are disabled — this is an entry sheet for
// work that's happened or is about to, not a scheduler.

function DatePickerModal({
  visible,
  selectedDate,
  onSelect,
  onClose,
}: {
  visible: boolean;
  selectedDate: Date;
  onSelect: (d: Date) => void;
  onClose: () => void;
}) {
  const today = useMemo(() => new Date(), [visible]);
  const [viewMonth, setViewMonth] = useState(() => new Date(selectedDate));

  useEffect(() => {
    if (visible) setViewMonth(new Date(selectedDate));
  }, [visible, selectedDate]);

  const quickPicks = useMemo(
    () => [
      { label: "Yesterday", date: addDays(today, -1) },
      { label: "Today", date: today },
      { label: "Tomorrow", date: addDays(today, 1) },
    ],
    [today]
  );

  const monthGrid = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const startWeekday = firstOfMonth.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells: (Date | null)[] = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [viewMonth]);

  const maxSelectable = addDays(today, 1); // "Tomorrow" is the furthest allowed
  const isDisabled = (d: Date) => d.getTime() > maxSelectable.getTime();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={modalStyles.backdrop}>
        <View style={modalStyles.sheet}>
          <View style={modalStyles.header}>
            <Text style={modalStyles.title}>Select Date</Text>
            <TouchableOpacity style={modalStyles.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={20} color={C.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Quick picks */}
          <View style={modalStyles.quickRow}>
            {quickPicks.map((qp) => {
              const active = isSameDay(qp.date, selectedDate);
              return (
                <TouchableOpacity
                  key={qp.label}
                  style={[modalStyles.quickChip, active && modalStyles.quickChipActive]}
                  onPress={() => {
                    onSelect(qp.date);
                    onClose();
                  }}
                >
                  <Text
                    style={[
                      modalStyles.quickChipText,
                      active && modalStyles.quickChipTextActive,
                    ]}
                  >
                    {qp.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Month nav */}
          <View style={modalStyles.monthNav}>
            <TouchableOpacity
              style={modalStyles.monthNavBtn}
              onPress={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
            >
              <Ionicons name="chevron-back" size={18} color={C.textSecondary} />
            </TouchableOpacity>
            <Text style={modalStyles.monthNavLabel}>
              {viewMonth.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
            </Text>
            <TouchableOpacity
              style={modalStyles.monthNavBtn}
              onPress={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
            >
              <Ionicons name="chevron-forward" size={18} color={C.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Weekday header */}
          <View style={modalStyles.weekdayRow}>
            {["S", "M", "T", "W", "T", "F", "S"].map((w, i) => (
              <Text key={`${w}-${i}`} style={modalStyles.weekdayText}>
                {w}
              </Text>
            ))}
          </View>

          {/* Day grid */}
          <ScrollView style={{ maxHeight: 280 }} contentContainerStyle={modalStyles.grid}>
            {monthGrid.map((cell, i) => {
              if (!cell) {
                return <View key={`empty-${i}`} style={modalStyles.dayCell} />;
              }
              const disabled = isDisabled(cell);
              const active = isSameDay(cell, selectedDate);
              const isToday = isSameDay(cell, today);
              return (
                <TouchableOpacity
                  key={cell.toISOString()}
                  style={[
                    modalStyles.dayCell,
                    active && modalStyles.dayCellActive,
                    isToday && !active && modalStyles.dayCellToday,
                  ]}
                  disabled={disabled}
                  onPress={() => {
                    onSelect(cell);
                    onClose();
                  }}
                >
                  <Text
                    style={[
                      modalStyles.dayText,
                      disabled && modalStyles.dayTextDisabled,
                      active && modalStyles.dayTextActive,
                    ]}
                  >
                    {cell.getDate()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function WastagePlantScreen() {
  const router = useRouter();

  const [items, setItems] = useState<MstItem[]>([]);
  const [entries, setEntries] = useState<WastageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateLoading, setDateLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [supervisorId, setSupervisorId] = useState<string>("");

  // Selected date for this entry sheet — defaults to today.
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [datePickerVisible, setDatePickerVisible] = useState(false);

  const dateLabel = formatFullDateLabel(selectedDate);
  const dateKey = toDateKey(selectedDate);

  useEffect(() => {
    bootstrap();
    // Only run once on mount — date changes are handled by the effect
    // below, which reuses the already-loaded items and just refetches
    // saved entries for the newly selected date.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch saved entries whenever the date changes (skip the very first
  // render, since bootstrap() already covers the initial date).
  const [hasBootstrapped, setHasBootstrapped] = useState(false);
  useEffect(() => {
    if (!hasBootstrapped || !supervisorId || items.length === 0) return;
    loadEntriesForDate(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey]);

  const buildEntriesFromSaved = (
    baseItems: MstItem[],
    savedMap: Record<string, { cartonWastage: string; pcsWastage: string; looseOil: string }>
  ): WastageRow[] =>
    baseItems.map((item) => ({
      itmcd: item.itmcd,
      itmnm: item.itmnm,
      itmsubcat: item.itmsubcat,
      cartonWastage: savedMap[item.itmcd]?.cartonWastage ?? "",
      pcsWastage: savedMap[item.itmcd]?.pcsWastage ?? "",
      looseOil: savedMap[item.itmcd]?.looseOil ?? "",
    }));

  const fetchSavedMapForDate = async (supId: string, date: Date) => {
    const key = toDateKey(date);
    const todayRes = await fetch(
      `${API_URL}/wastage/today-entries?supervisorId=${supId}&date=${key}`
    );
    const todayData = await todayRes.json();

    const savedMap: Record<string, { cartonWastage: string; pcsWastage: string; looseOil: string }> = {};
    if (todayData.success) {
      for (const e of todayData.data) {
        if (!savedMap[e.ITMCD]) {
          savedMap[e.ITMCD] = {
            cartonWastage: e.CARTON_WASTAGE != null ? String(e.CARTON_WASTAGE) : "",
            pcsWastage: e.PCS_WASTAGE != null ? String(e.PCS_WASTAGE) : "",
            looseOil: e.LOOSE_OIL != null ? String(e.LOOSE_OIL) : "",
          };
        }
      }
    }
    return savedMap;
  };

  const bootstrap = async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.EMPLOYEE);
      if (!raw) { router.back(); return; }

      const emp = JSON.parse(raw);
      if (emp.EMPTYPE !== "PPSUPERVISOR") {
        Alert.alert("Access Denied", "Only PP Supervisors can access this screen.");
        router.back();
        return;
      }
      setSupervisorId(emp.EMP_ID);

      const initialDate = new Date();
      const [itemsRes, savedMap] = await Promise.all([
        fetch(`${API_URL}/wastage/items`).then((r) => r.json()),
        fetchSavedMapForDate(emp.EMP_ID, initialDate),
      ]);

      if (itemsRes.success) {
        setItems(itemsRes.data);
        setEntries(buildEntriesFromSaved(itemsRes.data, savedMap));
      }
    } catch {
      Alert.alert("Error", "Failed to load data. Check your connection.");
    } finally {
      setLoading(false);
      setHasBootstrapped(true);
    }
  };

  // Called whenever the user picks a different date. Re-fetches that
  // date's saved entries and rebuilds the form from `items` (already
  // loaded) — any unsaved input for the previous date is intentionally
  // discarded, since it belongs to a different day's sheet.
  const loadEntriesForDate = async (date: Date) => {
    if (!supervisorId || items.length === 0) return;
    setDateLoading(true);
    try {
      const savedMap = await fetchSavedMapForDate(supervisorId, date);
      setEntries(buildEntriesFromSaved(items, savedMap));
    } catch {
      Alert.alert("Error", "Failed to load entries for that date.");
    } finally {
      setDateLoading(false);
    }
  };

  const updateEntry = useCallback(
    (idx: number, field: "cartonWastage" | "pcsWastage" | "looseOil", value: string) => {
      setEntries((prev) =>
        prev.map((e, i) => (i === idx ? { ...e, [field]: value } : e))
      );
    },
    []
  );

  const onDateSelected = (d: Date) => {
    setSelectedDate(d);
    // loadEntriesForDate runs via the dateKey effect above.
  };

  const reloadToday = async (supId: string, date: Date) => {
    try {
      const savedMap = await fetchSavedMapForDate(supId, date);
      setEntries((prev) =>
        prev.map((e) => (savedMap[e.itmcd] ? { ...e, ...savedMap[e.itmcd] } : e))
      );
    } catch {
      // silently ignore
    }
  };

  const handleSubmit = async () => {
    const validEntries = entries.filter(
      (e) => e.cartonWastage.trim() || e.pcsWastage.trim() || e.looseOil.trim()
    );

    if (validEntries.length === 0) {
      Alert.alert("Nothing to Submit", "Please fill in at least one row before submitting.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/wastage/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doneBy: supervisorId,
          date: dateKey,
          entries, // backend filters valid ones, and replaces any existing
                   // rows for this date/item/supervisor rather than
                   // double-inserting
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        Alert.alert("Saved", `${data.data.count} entries saved for ${formatDateLabel(selectedDate)}.`);
        await reloadToday(supervisorId, selectedDate);
      } else {
        Alert.alert("Error", data.message || "Submission failed");
      }
    } catch {
      Alert.alert("Error", "Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // Group by subcat
  const grouped = entries.reduce<
    Record<string, { label: string; rows: { entry: WastageRow; idx: number }[] }>
  >((acc, entry, idx) => {
    const key = entry.itmsubcat ?? "Other";
    if (!acc[key]) acc[key] = { label: key, rows: [] };
    acc[key].rows.push({ entry, idx });
    return acc;
  }, {});

  // A row is "touched" if any field has a value
  const touchedCount = entries.filter(
    (e) => e.cartonWastage.trim() || e.pcsWastage.trim() || e.looseOil.trim()
  ).length;

  const progress = entries.length > 0 ? touchedCount / entries.length : 0;

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={styles.loadingText}>Loading items…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        {/* ── Top Bar ── */}
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color={C.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.topBarTitle}>Wastage Plant</Text>
          </View>
          <View style={styles.progressPill}>
            <Text style={styles.progressPillText}>
              {touchedCount}/{entries.length}
            </Text>
          </View>
        </View>

        {/* ── Date Selector ── */}
        <TouchableOpacity
          style={styles.dateSelector}
          onPress={() => setDatePickerVisible(true)}
          disabled={dateLoading}
        >
          <Ionicons name="calendar-outline" size={16} color={C.primary} />
          <Text style={styles.dateSelectorText}>{dateLabel}</Text>
          {dateLoading ? (
            <ActivityIndicator size="small" color={C.primary} style={{ marginLeft: 4 }} />
          ) : (
            <Ionicons name="chevron-down" size={14} color={C.textMuted} style={{ marginLeft: 2 }} />
          )}
        </TouchableOpacity>

        {/* ── Progress Bar ── */}
        <View style={styles.progressBarTrack}>
          <View style={[styles.progressBarFill, { width: `${progress * 100}%` }]} />
        </View>

        {/* ── Column Headers ── */}
        <View style={styles.colHeader}>
          <Text style={[styles.colHeaderText, styles.colItem]}>Item</Text>
          <Text style={[styles.colHeaderText, styles.colNum]}>Ctn Wastage</Text>
          <Text style={[styles.colHeaderText, styles.colNum]}>Pcs Wastage</Text>
          <Text style={[styles.colHeaderText, styles.colNum]}>Loose Oil</Text>
        </View>

        {/* ── Table ── */}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {Object.values(grouped).map((group) => (
            <View key={group.label} style={styles.group}>
              {/* Category header */}
              <View style={styles.categoryRow}>
                <View style={styles.categoryDot} />
                <Text style={styles.categoryLabel}>{group.label}</Text>
                <View style={styles.categorySep} />
              </View>

              {/* Item rows */}
              <View style={styles.groupCard}>
                {group.rows.map(({ entry, idx }, rowIdx) => {
                  const isLast    = rowIdx === group.rows.length - 1;
                  const isTouched = entry.cartonWastage.trim() || entry.pcsWastage.trim() || entry.looseOil.trim();

                  return (
                    <View
                      key={entry.itmcd}
                      style={[
                        styles.tableRow,
                        !isLast && styles.tableRowBorder,
                        isTouched ? styles.tableRowDone : null,
                      ]}
                    >
                      {/* Item name */}
                      <View style={styles.colItem}>
                        <View style={styles.itemNameRow}>
                          {isTouched ? (
                            <Ionicons
                              name="checkmark-circle"
                              size={14}
                              color={C.green}
                              style={styles.itemIcon}
                            />
                          ) : (
                            <View style={styles.itemDot} />
                          )}
                          <Text style={styles.itemName}>{entry.itmnm}</Text>
                        </View>
                      </View>

                      {/* Carton Wastage */}
                      <View style={styles.colNum}>
                        <TextInput
                          style={[styles.numInput, entry.cartonWastage ? styles.numInputFilled : null]}
                          value={entry.cartonWastage}
                          onChangeText={(v) => updateEntry(idx, "cartonWastage", v)}
                          keyboardType="decimal-pad"
                          placeholder="0"
                          placeholderTextColor={C.textMuted}
                          returnKeyType="next"
                        />
                      </View>

                      {/* Pcs Wastage */}
                      <View style={styles.colNum}>
                        <TextInput
                          style={[styles.numInput, entry.pcsWastage ? styles.numInputFilled : null]}
                          value={entry.pcsWastage}
                          onChangeText={(v) => updateEntry(idx, "pcsWastage", v)}
                          keyboardType="decimal-pad"
                          placeholder="0"
                          placeholderTextColor={C.textMuted}
                          returnKeyType="next"
                        />
                      </View>

                      {/* Loose Oil */}
                      <View style={styles.colNum}>
                        <TextInput
                          style={[styles.numInput, entry.looseOil ? styles.numInputFilledOil : null]}
                          value={entry.looseOil}
                          onChangeText={(v) => updateEntry(idx, "looseOil", v)}
                          keyboardType="decimal-pad"
                          placeholder="—"
                          placeholderTextColor={C.textMuted}
                          returnKeyType="done"
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          ))}

          <View style={{ height: 24 }} />
        </ScrollView>

        {/* ── Submit Footer ── */}
        <View style={styles.footer}>
          <View style={styles.footerInfo}>
            <Text style={styles.footerLabel}>
              {touchedCount === entries.length && entries.length > 0
                ? "All items filled ✓"
                : touchedCount > 0
                ? `${touchedCount} item${touchedCount > 1 ? "s" : ""} ready to submit`
                : "Fill in wastage values to submit"}
            </Text>
            {touchedCount > 0 && touchedCount < entries.length && (
              <Text style={styles.footerSub}>
                {entries.length - touchedCount} blank (will be skipped)
              </Text>
            )}
          </View>
          <TouchableOpacity
            style={[
              styles.submitBtn,
              submitting && styles.submitBtnDisabled,
              touchedCount === 0 && styles.submitBtnIncomplete,
            ]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color={C.textInverse} size="small" />
            ) : (
              <>
                <Ionicons name="cloud-upload-outline" size={20} color={C.textInverse} />
                <Text style={styles.submitBtnText}>Submit</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* ── Date Picker Modal ── */}
      <DatePickerModal
        visible={datePickerVisible}
        selectedDate={selectedDate}
        onSelect={onDateSelected}
        onClose={() => setDatePickerVisible(false)}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: C.pageBg },
  loadingBox:  { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  loadingText: { color: C.textMuted, fontSize: 14 },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: C.cardBg,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.border,
    justifyContent: "center", alignItems: "center",
  },
  topBarTitle: { color: C.textPrimary, fontSize: 17, fontWeight: "800", letterSpacing: -0.3 },
  topBarSub:   { color: C.textMuted, fontSize: 12, marginTop: 1 },
  progressPill: {
    backgroundColor: C.primaryLight, borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 5,
    borderWidth: 1, borderColor: C.primaryMuted,
  },
  progressPillText: { color: C.primary, fontSize: 12, fontWeight: "700" },

  // Date selector — sits between the top bar and progress bar, tappable
  // to open DatePickerModal. Same treatment as the filling screen.
  dateSelector: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: C.inputBg,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  dateSelectorText: {
    color: C.textPrimary,
    fontSize: 13,
    fontWeight: "700",
  },

  progressBarTrack: { height: 3, backgroundColor: C.border },
  progressBarFill:  { height: 3, backgroundColor: C.primary },

  colHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: C.inputBg,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  colHeaderText: {
    fontSize: 10, fontWeight: "700", color: C.textMuted,
    textTransform: "uppercase", letterSpacing: 0.8,
  },

  // Item col gets more room; 3 numeric cols share the rest equally
  colItem: { flex: 4, paddingRight: 6 },
  colNum:  { flex: 2, paddingHorizontal: 3 },

  scroll:        { flex: 1 },
  scrollContent: { paddingHorizontal: 14, paddingTop: 12 },

  group:       { marginBottom: 16 },
  categoryRow: { flexDirection: "row", alignItems: "center", marginBottom: 8, gap: 8 },
  categoryDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary },
  categoryLabel: {
    color: C.textSecondary, fontSize: 12, fontWeight: "700",
    letterSpacing: 0.5, textTransform: "uppercase",
  },
  categorySep: { flex: 1, height: 1, backgroundColor: C.border },

  groupCard: {
    backgroundColor: C.cardBg,
    borderRadius: 14, borderWidth: 1, borderColor: C.border,
    overflow: "hidden",
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 3, elevation: 1,
  },

  tableRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  tableRowBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  tableRowDone:   { backgroundColor: C.greenBg },

  itemNameRow: { flexDirection: "row", alignItems: "flex-start" },
  itemIcon:    { marginRight: 4, marginTop: 2, flexShrink: 0 },
  itemDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: C.borderStrong,
    marginTop: 6, marginRight: 5, flexShrink: 0,
  },
  itemName: {
    color: C.textPrimary, fontSize: 13, fontWeight: "500",
    lineHeight: 18, flex: 1, flexWrap: "wrap",
  },

  numInput: {
    backgroundColor: C.inputBg,
    borderWidth: 1, borderColor: C.border, borderRadius: 8,
    paddingHorizontal: 4, paddingVertical: 7,
    fontSize: 12, color: C.textPrimary,
    textAlign: "center", fontWeight: "600",
  },
  numInputFilled: {
    backgroundColor: C.primaryLight,
    borderColor: C.primaryMuted,
    color: C.primary,
  },
  // Loose Oil gets a slightly amber tint to match "optional / received" feel
  numInputFilledOil: {
    backgroundColor: C.amberBg,
    borderColor: C.amberLight,
    color: C.amber,
  },

  footer: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: C.border,
    backgroundColor: C.cardBg, gap: 12,
  },
  footerInfo:  { flex: 1 },
  footerLabel: { color: C.textSecondary, fontSize: 13, fontWeight: "500" },
  footerSub:   { color: C.textMuted, fontSize: 11, marginTop: 2 },

  submitBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.primary, borderRadius: 12,
    paddingVertical: 13, paddingHorizontal: 20,
  },
  submitBtnDisabled:   { backgroundColor: C.primaryMuted },
  submitBtnIncomplete: { backgroundColor: C.primaryDark, opacity: 0.7 },
  submitBtnText:       { color: C.textInverse, fontSize: 14, fontWeight: "800" },
});

// ─── Date Modal Styles ────────────────────────────────────────────────────────

const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: C.cardBg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "70%",
    borderTopWidth: 1,
    borderColor: C.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  title: { color: C.textPrimary, fontSize: 16, fontWeight: "800" },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: C.inputBg,
    borderWidth: 1,
    borderColor: C.border,
    justifyContent: "center",
    alignItems: "center",
  },
  quickRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  quickChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: C.inputBg,
    borderWidth: 1,
    borderColor: C.border,
  },
  quickChipActive: {
    backgroundColor: C.primaryLight,
    borderColor: C.primaryMuted,
  },
  quickChipText: {
    color: C.textSecondary,
    fontSize: 13,
    fontWeight: "700",
  },
  quickChipTextActive: {
    color: C.primary,
  },
  monthNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  monthNavBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: C.inputBg,
    borderWidth: 1,
    borderColor: C.border,
    justifyContent: "center",
    alignItems: "center",
  },
  monthNavLabel: {
    color: C.textPrimary,
    fontSize: 14,
    fontWeight: "800",
  },
  weekdayRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  weekdayText: {
    flex: 1,
    textAlign: "center",
    color: C.textMuted,
    fontSize: 11,
    fontWeight: "700",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 12,
    paddingBottom: 20,
  },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 2,
  },
  dayCellActive: {
    backgroundColor: C.primary,
    borderRadius: 999,
  },
  dayCellToday: {
    borderWidth: 1,
    borderColor: C.primaryMuted,
    borderRadius: 999,
  },
  dayText: {
    color: C.textPrimary,
    fontSize: 13,
    fontWeight: "600",
  },
  dayTextDisabled: {
    color: C.textMuted,
    opacity: 0.35,
  },
  dayTextActive: {
    color: C.textInverse,
    fontWeight: "800",
  },
});