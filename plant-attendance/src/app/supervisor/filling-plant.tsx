import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
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

type Operator = {
  EMP_ID: string;
  EMPNAME: string;
  EMPFNAME: string;
  EMPDESG: string;
};

type EntryRow = {
  itmcd: string;
  itmnm: string;
  itmsubcat: string | null;
  batchNo: string;
  filling: string;
  wastage: string;
  operatorId: string;
  operatorName: string;
};

// ─── Date helpers ─────────────────────────────────────────────────────────────
// Local-date (not UTC) "YYYY-MM-DD" key, since that's what the backend's
// dayRange() expects and what we use to compare "is this today/yesterday".
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

// ─── Operator Picker Modal ────────────────────────────────────────────────────

function OperatorPickerModal({
  visible,
  operators,
  selectedId,
  onSelect,
  onClose,
}: {
  visible: boolean;
  operators: Operator[];
  selectedId: string;
  onSelect: (op: Operator) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = operators.filter(
    (o) =>
      o.EMPNAME.toLowerCase().includes(search.toLowerCase()) ||
      o.EMPFNAME.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={modalStyles.backdrop}>
        <View style={modalStyles.sheet}>
          <View style={modalStyles.header}>
            <Text style={modalStyles.title}>Select Operator</Text>
            <TouchableOpacity style={modalStyles.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={20} color={C.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={modalStyles.searchRow}>
            <Ionicons name="search" size={16} color={C.textMuted} />
            <TextInput
              style={modalStyles.searchInput}
              placeholder="Search operator..."
              placeholderTextColor={C.textMuted}
              value={search}
              onChangeText={setSearch}
              autoFocus
            />
          </View>

          <FlatList
            data={filtered}
            keyExtractor={(item) => item.EMP_ID}
            style={modalStyles.list}
            renderItem={({ item }) => {
              const isSelected = item.EMP_ID === selectedId;
              const initials = `${item.EMPNAME[0]}${item.EMPFNAME[0]}`.toUpperCase();
              return (
                <TouchableOpacity
                  style={[modalStyles.opRow, isSelected && modalStyles.opRowSelected]}
                  onPress={() => {
                    onSelect(item);
                    onClose();
                    setSearch("");
                  }}
                >
                  <View style={[modalStyles.opAvatar, isSelected && modalStyles.opAvatarSelected]}>
                    <Text style={[modalStyles.opAvatarText, isSelected && modalStyles.opAvatarTextSelected]}>
                      {initials}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[modalStyles.opName, isSelected && modalStyles.opNameSelected]}>
                      {item.EMPNAME} {item.EMPFNAME}
                    </Text>
                    <Text style={modalStyles.opDesg}>{item.EMPDESG}</Text>
                  </View>
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={20} color={C.primary} />
                  )}
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <Text style={modalStyles.emptyText}>No operators found</Text>
            }
          />
        </View>
      </View>
    </Modal>
  );
}

// ─── Date Picker Modal ────────────────────────────────────────────────────────
// Built from the same primitives as OperatorPickerModal (no new native
// dependency). Two levels: a quick-pick strip for the common cases, and a
// "Choose a date" month grid for anything further out. Future dates beyond
// "Tomorrow" are disabled — this is an entry sheet for work that's happened
// or is about to, not a scheduler.

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

  // Build a 6-row grid for viewMonth, Sunday-first, padded with nulls.
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
          <View style={dateModalStyles.quickRow}>
            {quickPicks.map((qp) => {
              const active = isSameDay(qp.date, selectedDate);
              return (
                <TouchableOpacity
                  key={qp.label}
                  style={[dateModalStyles.quickChip, active && dateModalStyles.quickChipActive]}
                  onPress={() => {
                    onSelect(qp.date);
                    onClose();
                  }}
                >
                  <Text
                    style={[
                      dateModalStyles.quickChipText,
                      active && dateModalStyles.quickChipTextActive,
                    ]}
                  >
                    {qp.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Month nav */}
          <View style={dateModalStyles.monthNav}>
            <TouchableOpacity
              style={dateModalStyles.monthNavBtn}
              onPress={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
            >
              <Ionicons name="chevron-back" size={18} color={C.textSecondary} />
            </TouchableOpacity>
            <Text style={dateModalStyles.monthNavLabel}>
              {viewMonth.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
            </Text>
            <TouchableOpacity
              style={dateModalStyles.monthNavBtn}
              onPress={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
            >
              <Ionicons name="chevron-forward" size={18} color={C.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Weekday header */}
          <View style={dateModalStyles.weekdayRow}>
            {["S", "M", "T", "W", "T", "F", "S"].map((w, i) => (
              <Text key={`${w}-${i}`} style={dateModalStyles.weekdayText}>
                {w}
              </Text>
            ))}
          </View>

          {/* Day grid */}
          <ScrollView style={{ maxHeight: 280 }} contentContainerStyle={dateModalStyles.grid}>
            {monthGrid.map((cell, i) => {
              if (!cell) {
                return <View key={`empty-${i}`} style={dateModalStyles.dayCell} />;
              }
              const disabled = isDisabled(cell);
              const active = isSameDay(cell, selectedDate);
              const isToday = isSameDay(cell, today);
              return (
                <TouchableOpacity
                  key={cell.toISOString()}
                  style={[
                    dateModalStyles.dayCell,
                    active && dateModalStyles.dayCellActive,
                    isToday && !active && dateModalStyles.dayCellToday,
                  ]}
                  disabled={disabled}
                  onPress={() => {
                    onSelect(cell);
                    onClose();
                  }}
                >
                  <Text
                    style={[
                      dateModalStyles.dayText,
                      disabled && dateModalStyles.dayTextDisabled,
                      active && dateModalStyles.dayTextActive,
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

export default function FillingPlantScreen() {
  const router = useRouter();

  const [items, setItems] = useState<MstItem[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateLoading, setDateLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [supervisorId, setSupervisorId] = useState<string>("");

  // Selected date for this entry sheet — defaults to today.
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());

  // Operator picker state
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerTargetIdx, setPickerTargetIdx] = useState<number | null>(null);

  // Date picker state
  const [datePickerVisible, setDatePickerVisible] = useState(false);

  const dateLabel = formatFullDateLabel(selectedDate);
  const dateKey = toDateKey(selectedDate);

  useEffect(() => {
    bootstrap();
    // Only run once on mount — date changes are handled by the effect below,
    // which reuses the already-loaded items/operators and just refetches
    // saved entries for the newly selected date.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch saved entries whenever the date changes (but skip the very
  // first render, since bootstrap() already covers the initial date).
  const [hasBootstrapped, setHasBootstrapped] = useState(false);
  useEffect(() => {
    if (!hasBootstrapped || !supervisorId || items.length === 0) return;
    loadEntriesForDate(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey]);

  const buildEntriesFromSaved = (
    baseItems: MstItem[],
    savedMap: Record<
      string,
      { batchNo: string; filling: string; wastage: string; operatorId: string; operatorName: string }
    >
  ): EntryRow[] =>
    baseItems.map((item) => ({
      itmcd: item.itmcd,
      itmnm: item.itmnm,
      itmsubcat: item.itmsubcat,
      batchNo: savedMap[item.itmcd]?.batchNo ?? "",
      filling: savedMap[item.itmcd]?.filling ?? "",
      wastage: savedMap[item.itmcd]?.wastage ?? "",
      operatorId: savedMap[item.itmcd]?.operatorId ?? "",
      operatorName: savedMap[item.itmcd]?.operatorName ?? "",
    }));

  const fetchSavedMapForDate = async (supId: string, date: Date) => {
    const key = toDateKey(date);
    const todayRes = await fetch(
      `${API_URL}/filling/today-entries?supervisorId=${supId}&date=${key}`
    );
    const todayData = await todayRes.json();

    const savedMap: Record<
      string,
      { batchNo: string; filling: string; wastage: string; operatorId: string; operatorName: string }
    > = {};
    if (todayData.success) {
      for (const e of todayData.data) {
        if (!savedMap[e.ITMCD]) {
          savedMap[e.ITMCD] = {
            batchNo: e.BATCH_NO ?? "",
            filling: String(e.FILLING),
            wastage: String(e.WASTAGE),
            operatorId: e.OPERATOR_ID,
            operatorName: e.operator
              ? `${e.operator.EMPNAME} ${e.operator.EMPFNAME}`
              : "",
          };
        }
      }
    }
    return savedMap;
  };

  const bootstrap = async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.EMPLOYEE);
      if (raw) {
        const emp = JSON.parse(raw);
        if (emp.EMPTYPE !== "PPSUPERVISOR") {
          Alert.alert("Access Denied", "Only PP Supervisors can access this screen.");
          router.back();
          return;
        }
        setSupervisorId(emp.EMP_ID);

        const initialDate = new Date();
        const [itemsRes, opsRes, savedMap] = await Promise.all([
          fetch(`${API_URL}/filling/items`).then((r) => r.json()),
          fetch(`${API_URL}/filling/operators`).then((r) => r.json()),
          fetchSavedMapForDate(emp.EMP_ID, initialDate),
        ]);

        if (opsRes.success) {
          setOperators(opsRes.data);
        }

        if (itemsRes.success) {
          setItems(itemsRes.data);
          setEntries(buildEntriesFromSaved(itemsRes.data, savedMap));
        }
      }
    } catch (err) {
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
    (idx: number, field: "batchNo" | "filling" | "wastage", value: string) => {
      setEntries((prev) =>
        prev.map((e, i) => (i === idx ? { ...e, [field]: value } : e))
      );
    },
    []
  );

  const openOperatorPicker = (idx: number) => {
    setPickerTargetIdx(idx);
    setPickerVisible(true);
  };

  const onOperatorSelected = (op: Operator) => {
    if (pickerTargetIdx === null) return;
    setEntries((prev) =>
      prev.map((e, i) =>
        i === pickerTargetIdx
          ? { ...e, operatorId: op.EMP_ID, operatorName: `${op.EMPNAME} ${op.EMPFNAME}` }
          : e
      )
    );
    setPickerTargetIdx(null);
  };

  const onDateSelected = (d: Date) => {
    setSelectedDate(d);
    // loadEntriesForDate runs via the dateKey effect above.
  };

  const reloadToday = async (supId: string, date: Date) => {
    try {
      const savedMap = await fetchSavedMapForDate(supId, date);
      setEntries((prev) =>
        prev.map((e) =>
          savedMap[e.itmcd] ? { ...e, ...savedMap[e.itmcd] } : e
        )
      );
    } catch {
      // silently ignore reload errors
    }
  };

  const handleSubmit = async () => {
    // Only submit rows that are fully filled out
    const validEntries = entries.filter(
      (e) => e.filling.trim() && e.wastage.trim() && e.operatorId
    );

    if (validEntries.length === 0) {
      Alert.alert(
        "Nothing to Submit",
        "Please complete at least one item (filling, wastage, and operator) before submitting."
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/filling/submit`, {
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
        // Reload this date's entries so the form reflects what's in the DB
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

  // Group entries by subcat
  const grouped = entries.reduce<
    Record<string, { label: string; rows: { entry: EntryRow; idx: number }[] }>
  >((acc, entry, idx) => {
    const key = entry.itmsubcat ?? "Other";
    if (!acc[key]) acc[key] = { label: key, rows: [] };
    acc[key].rows.push({ entry, idx });
    return acc;
  }, {});

  const filledCount = entries.filter(
    (e) => e.filling.trim() && e.wastage.trim() && e.operatorId
  ).length;

  const progress = entries.length > 0 ? filledCount / entries.length : 0;

  // Totals for the Filling and Wastage columns (the two middle columns
  // between Batch and Operator), shown in a footer row at the bottom
  // of the table. Blank/non-numeric inputs count as 0 so a partially
  // filled sheet still gives a running total rather than NaN.
  const totalFilling = entries.reduce(
    (sum, e) => sum + (parseFloat(e.filling) || 0),
    0
  );
  const totalWastage = entries.reduce(
    (sum, e) => sum + (parseFloat(e.wastage) || 0),
    0
  );
  const formatTotal = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(2));

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
            <Text style={styles.topBarTitle}>Filling Plant</Text>
          </View>
          <View style={styles.progressPill}>
            <Text style={styles.progressPillText}>
              {filledCount}/{entries.length}
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
          <Text style={[styles.colHeaderText, styles.colBatch]}>Batch</Text>
          <Text style={[styles.colHeaderText, styles.colFilling]}>Filling</Text>
          <Text style={[styles.colHeaderText, styles.colWastage]}>Wastage</Text>
          <Text style={[styles.colHeaderText, styles.colOperator]}>Operator</Text>
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
                  const isLast = rowIdx === group.rows.length - 1;
                  const isComplete =
                    entry.filling.trim() && entry.wastage.trim() && entry.operatorId;

                  return (
                    <View
                      key={entry.itmcd}
                      style={[
                        styles.tableRow,
                        !isLast && styles.tableRowBorder,
                        isComplete ? styles.tableRowDone : null,
                      ]}
                    >
                      {/* Item name — full wrap, no truncation */}
                      <View style={styles.colItem}>
                        <View style={styles.itemNameRow}>
                          {isComplete ? (
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

                      {/* Batch No input */}
                      <View style={styles.colBatch}>
                        <TextInput
                          style={[
                            styles.batchInput,
                            entry.batchNo ? styles.batchInputFilled : null,
                          ]}
                          value={entry.batchNo}
                          onChangeText={(v) => updateEntry(idx, "batchNo", v)}
                          placeholder="—"
                          placeholderTextColor={C.textMuted}
                          autoCapitalize="characters"
                          returnKeyType="next"
                        />
                      </View>

                      {/* Filling input */}
                      <View style={styles.colFilling}>
                        <TextInput
                          style={[
                            styles.numInput,
                            entry.filling ? styles.numInputFilled : null,
                          ]}
                          value={entry.filling}
                          onChangeText={(v) => updateEntry(idx, "filling", v)}
                          keyboardType="decimal-pad"
                          placeholder="0"
                          placeholderTextColor={C.textMuted}
                          returnKeyType="next"
                        />
                      </View>

                      {/* Wastage input */}
                      <View style={styles.colWastage}>
                        <TextInput
                          style={[
                            styles.numInput,
                            entry.wastage ? styles.numInputFilled : null,
                          ]}
                          value={entry.wastage}
                          onChangeText={(v) => updateEntry(idx, "wastage", v)}
                          keyboardType="decimal-pad"
                          placeholder="0"
                          placeholderTextColor={C.textMuted}
                          returnKeyType="done"
                        />
                      </View>

                      {/* Operator selector */}
                      <View style={styles.colOperator}>
                        <TouchableOpacity
                          style={[
                            styles.opSelector,
                            entry.operatorId ? styles.opSelectorFilled : null,
                          ]}
                          onPress={() => openOperatorPicker(idx)}
                        >
                          {entry.operatorId ? (
                            <Text style={styles.opSelectorFilledText} numberOfLines={1}>
                              {entry.operatorName.split(" ")[0]}
                            </Text>
                          ) : (
                            <Ionicons
                              name="person-add-outline"
                              size={16}
                              color={C.textMuted}
                            />
                          )}
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          ))}

          {/* ── Totals Row — sums the Filling and Wastage columns ── */}
          {entries.length > 0 && (
            <View style={styles.totalsRow}>
              <Text style={[styles.totalsLabel, styles.colItem]}>Total</Text>
              <View style={styles.colBatch} />
              <Text style={[styles.totalsValue, styles.colFilling]}>
                {formatTotal(totalFilling)}
              </Text>
              <Text style={[styles.totalsValue, styles.colWastage]}>
                {formatTotal(totalWastage)}
              </Text>
              <View style={styles.colOperator} />
            </View>
          )}

          {/* Bottom spacer */}
          <View style={{ height: 24 }} />
        </ScrollView>

        {/* ── Submit Footer ── */}
        <View style={styles.footer}>
          <View style={styles.footerInfo}>
            <Text style={styles.footerLabel}>
              {filledCount === entries.length && entries.length > 0
                ? "All items complete ✓"
                : filledCount > 0
                ? `${filledCount} item${filledCount > 1 ? "s" : ""} ready to submit`
                : "Fill in items to submit"}
            </Text>
            {filledCount > 0 && filledCount < entries.length && (
              <Text style={styles.footerSub}>
                {entries.length - filledCount} incomplete (will be skipped)
              </Text>
            )}
          </View>
          <TouchableOpacity
            style={[
              styles.submitBtn,
              submitting && styles.submitBtnDisabled,
              filledCount === 0 && styles.submitBtnIncomplete,
            ]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color={C.textInverse} size="small" />
            ) : (
              <>
                <Ionicons name="cloud-upload-outline" size={20} color={C.textInverse} />
                <Text style={styles.submitBtnText}>Submit Entry</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* ── Operator Picker Modal ── */}
      <OperatorPickerModal
        visible={pickerVisible}
        operators={operators}
        selectedId={
          pickerTargetIdx !== null ? entries[pickerTargetIdx]?.operatorId : ""
        }
        onSelect={onOperatorSelected}
        onClose={() => {
          setPickerVisible(false);
          setPickerTargetIdx(null);
        }}
      />

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
  container: { flex: 1, backgroundColor: C.pageBg },

  loadingBox: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  loadingText: { color: C.textMuted, fontSize: 14 },

  // Top bar
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
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: C.inputBg,
    borderWidth: 1,
    borderColor: C.border,
    justifyContent: "center",
    alignItems: "center",
  },
  topBarTitle: {
    color: C.textPrimary,
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  topBarSub: {
    color: C.textMuted,
    fontSize: 12,
    marginTop: 1,
  },
  progressPill: {
    backgroundColor: C.primaryLight,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: C.primaryMuted,
  },
  progressPillText: {
    color: C.primary,
    fontSize: 12,
    fontWeight: "700",
  },

  // Date selector — sits between the top bar and progress bar, tappable
  // to open DatePickerModal. Kept visually lighter than the top bar so it
  // reads as a filter/control rather than a second title row.
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

  // Progress bar
  progressBarTrack: {
    height: 3,
    backgroundColor: C.border,
  },
  progressBarFill: {
    height: 3,
    backgroundColor: C.primary,
  },

  // Column headers
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
    fontSize: 10,
    fontWeight: "700",
    color: C.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },

  // Column widths — item gets more flex so names have room.
  // Batch/Filling/Wastage/Operator share the remaining space; batch is
  // narrower than the numeric columns since codes are usually short.
  colItem:     { flex: 4, paddingRight: 6 },
  colBatch:    { flex: 1.6, paddingHorizontal: 3 },
  colFilling:  { flex: 1.8, paddingHorizontal: 3 },
  colWastage:  { flex: 1.8, paddingHorizontal: 3 },
  colOperator: { flex: 1.8, paddingLeft: 3 },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 14, paddingTop: 12 },

  // Group / category
  group: { marginBottom: 16 },
  categoryRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    gap: 8,
  },
  categoryDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.primary,
  },
  categoryLabel: {
    color: C.textSecondary,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  categorySep: {
    flex: 1,
    height: 1,
    backgroundColor: C.border,
  },

  groupCard: {
    backgroundColor: C.cardBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 3,
    elevation: 1,
  },

  // Table row — no fixed minHeight, aligns to top so tall item names look right
  tableRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  tableRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  tableRowDone: {
    backgroundColor: C.greenBg,
  },

  // Item name — wraps fully, no truncation
  itemNameRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  itemIcon: {
    marginRight: 4,
    marginTop: 2,
    flexShrink: 0,
  },
  itemDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.borderStrong,
    marginTop: 6,
    marginRight: 5,
    flexShrink: 0,
  },
  itemName: {
    color: C.textPrimary,
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 18,
    flex: 1,
    flexWrap: "wrap",
  },

  // Batch No input — text field, left-aligned since values are usually
  // alphanumeric codes rather than numbers
  batchInput: {
    backgroundColor: C.inputBg,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 7,
    fontSize: 12,
    color: C.textPrimary,
    textAlign: "center",
    fontWeight: "600",
  },
  batchInputFilled: {
    backgroundColor: C.primaryLight,
    borderColor: C.primaryMuted,
    color: C.primary,
  },

  // Number inputs
  numInput: {
    backgroundColor: C.inputBg,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 7,
    fontSize: 13,
    color: C.textPrimary,
    textAlign: "center",
    fontWeight: "600",
  },
  numInputFilled: {
    backgroundColor: C.primaryLight,
    borderColor: C.primaryMuted,
    color: C.primary,
  },

  // Operator selector
  opSelector: {
    backgroundColor: C.inputBg,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    height: 34,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 6,
  },
  opSelectorFilled: {
    backgroundColor: C.subtleBg,
    borderColor: C.primaryMuted,
  },
  opSelectorFilledText: {
    color: C.primary,
    fontSize: 11,
    fontWeight: "700",
  },

  // Totals row — sits below the last category card, sums Filling and
  // Wastage. Uses the same column flex widths as the table so the
  // numbers line up directly under their columns.
  totalsRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.inputBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 4,
  },
  totalsLabel: {
    color: C.textSecondary,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  totalsValue: {
    color: C.primary,
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
  },

  // Footer
  footer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.cardBg,
    gap: 12,
  },
  footerInfo: { flex: 1 },
  footerLabel: {
    color: C.textSecondary,
    fontSize: 13,
    fontWeight: "500",
  },
  footerSub: {
    color: C.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 20,
  },
  submitBtnDisabled: { backgroundColor: C.primaryMuted },
  submitBtnIncomplete: { backgroundColor: C.primaryDark, opacity: 0.7 },
  submitBtnText: {
    color: C.textInverse,
    fontSize: 14,
    fontWeight: "800",
  },
});

// ─── Modal Styles ─────────────────────────────────────────────────────────────

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
  title: {
    color: C.textPrimary,
    fontSize: 16,
    fontWeight: "800",
  },
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
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginVertical: 12,
    backgroundColor: C.inputBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: {
    flex: 1,
    color: C.textPrimary,
    fontSize: 14,
  },
  list: { paddingHorizontal: 12, paddingBottom: 24 },
  opRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 4,
  },
  opRowSelected: {
    backgroundColor: C.primaryLight,
  },
  opAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.inputBg,
    borderWidth: 1,
    borderColor: C.border,
    justifyContent: "center",
    alignItems: "center",
  },
  opAvatarSelected: {
    backgroundColor: C.primary,
    borderColor: C.primaryDark,
  },
  opAvatarText: {
    color: C.textSecondary,
    fontSize: 13,
    fontWeight: "700",
  },
  opAvatarTextSelected: {
    color: C.textInverse,
  },
  opName: {
    color: C.textPrimary,
    fontSize: 14,
    fontWeight: "600",
  },
  opNameSelected: { color: C.primaryDark },
  opDesg: {
    color: C.textMuted,
    fontSize: 12,
    marginTop: 1,
  },
  emptyText: {
    color: C.textMuted,
    textAlign: "center",
    marginTop: 24,
    fontSize: 14,
  },
});

// ─── Date Modal Styles ────────────────────────────────────────────────────────

const dateModalStyles = StyleSheet.create({
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