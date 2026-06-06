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
import { useEffect, useState, useCallback } from "react";
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
  filling: string;
  wastage: string;
  operatorId: string;
  operatorName: string;
};

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

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function FillingPlantScreen() {
  const router = useRouter();

  const [items, setItems] = useState<MstItem[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [supervisorId, setSupervisorId] = useState<string>("");

  // Operator picker state
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerTargetIdx, setPickerTargetIdx] = useState<number | null>(null);

  // Date
  const now = new Date();
  const dateLabel = now.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  useEffect(() => {
    bootstrap();
  }, []);

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

        const [itemsRes, opsRes, todayRes] = await Promise.all([
          fetch(`${API_URL}/filling/items`),
          fetch(`${API_URL}/filling/operators`),
          fetch(`${API_URL}/filling/today-entries?supervisorId=${emp.EMP_ID}`),
        ]);

        const itemsData = await itemsRes.json();
        const opsData   = await opsRes.json();
        const todayData = await todayRes.json();

        // Build a lookup of already-saved entries by itmcd (API returns desc, so first = most recent)
        const savedMap: Record<
          string,
          { filling: string; wastage: string; operatorId: string; operatorName: string }
        > = {};
        if (todayData.success) {
          for (const e of todayData.data) {
            if (!savedMap[e.ITMCD]) {
              savedMap[e.ITMCD] = {
                filling:      String(e.FILLING),
                wastage:      String(e.WASTAGE),
                operatorId:   e.OPERATOR_ID,
                operatorName: e.operator
                  ? `${e.operator.EMPNAME} ${e.operator.EMPFNAME}`
                  : "",
              };
            }
          }
        }

        if (opsData.success) {
          setOperators(opsData.data);
        }

        if (itemsData.success) {
          setItems(itemsData.data);
          setEntries(
            itemsData.data.map((item: MstItem) => ({
              itmcd:        item.itmcd,
              itmnm:        item.itmnm,
              itmsubcat:    item.itmsubcat,
              filling:      savedMap[item.itmcd]?.filling      ?? "",
              wastage:      savedMap[item.itmcd]?.wastage      ?? "",
              operatorId:   savedMap[item.itmcd]?.operatorId   ?? "",
              operatorName: savedMap[item.itmcd]?.operatorName ?? "",
            }))
          );
        }
      }
    } catch (err) {
      Alert.alert("Error", "Failed to load data. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  const updateEntry = useCallback(
    (idx: number, field: "filling" | "wastage", value: string) => {
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

  const reloadToday = async (supId: string) => {
    try {
      const todayRes  = await fetch(`${API_URL}/filling/today-entries?supervisorId=${supId}`);
      const todayData = await todayRes.json();
      if (!todayData.success) return;

      const savedMap: Record<string, { filling: string; wastage: string; operatorId: string; operatorName: string }> = {};
      for (const e of todayData.data) {
        if (!savedMap[e.ITMCD]) {
          savedMap[e.ITMCD] = {
            filling:      String(e.FILLING),
            wastage:      String(e.WASTAGE),
            operatorId:   e.OPERATOR_ID,
            operatorName: e.operator ? `${e.operator.EMPNAME} ${e.operator.EMPFNAME}` : "",
          };
        }
      }

      setEntries((prev) =>
        prev.map((e) =>
          savedMap[e.itmcd]
            ? { ...e, ...savedMap[e.itmcd] }
            : e
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
          entries, // backend filters valid ones
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        Alert.alert("Saved", `${data.data.count} entries saved.`);
        // Reload today's entries so the form reflects what's in the DB
        await reloadToday(supervisorId);
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
            <Text style={styles.topBarSub}>{dateLabel}</Text>
          </View>
          <View style={styles.progressPill}>
            <Text style={styles.progressPillText}>
              {filledCount}/{entries.length}
            </Text>
          </View>
        </View>

        {/* ── Progress Bar ── */}
        <View style={styles.progressBarTrack}>
          <View style={[styles.progressBarFill, { width: `${progress * 100}%` }]} />
        </View>

        {/* ── Column Headers ── */}
        <View style={styles.colHeader}>
          <Text style={[styles.colHeaderText, styles.colItem]}>Item</Text>
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

  // Column widths — item gets more flex so names have room
  colItem:     { flex: 4, paddingRight: 6 },
  colFilling:  { flex: 2, paddingHorizontal: 4 },
  colWastage:  { flex: 2, paddingHorizontal: 4 },
  colOperator: { flex: 2, paddingLeft: 4 },

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