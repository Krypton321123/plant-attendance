import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
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

type WastageRow = {
  itmcd: string;
  itmnm: string;
  itmsubcat: string | null;
  cartonWastage: string;
  pcsWastage: string;
  looseOil: string;
};

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function WastagePlantScreen() {
  const router = useRouter();

  const [entries, setEntries] = useState<WastageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [supervisorId, setSupervisorId] = useState<string>("");

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
      if (!raw) { router.back(); return; }

      const emp = JSON.parse(raw);
      if (emp.EMPTYPE !== "PPSUPERVISOR") {
        Alert.alert("Access Denied", "Only PP Supervisors can access this screen.");
        router.back();
        return;
      }
      setSupervisorId(emp.EMP_ID);

      const [itemsRes, todayRes] = await Promise.all([
        fetch(`${API_URL}/wastage/items`),
        fetch(`${API_URL}/wastage/today-entries?supervisorId=${emp.EMP_ID}`),
      ]);

      const itemsData = await itemsRes.json();
      const todayData = await todayRes.json();

      // Build lookup from today's saved entries (desc order → first = most recent)
      const savedMap: Record<string, { cartonWastage: string; pcsWastage: string; looseOil: string }> = {};
      if (todayData.success) {
        for (const e of todayData.data) {
          if (!savedMap[e.ITMCD]) {
            savedMap[e.ITMCD] = {
              cartonWastage: e.CARTON_WASTAGE != null ? String(e.CARTON_WASTAGE) : "",
              pcsWastage:    e.PCS_WASTAGE    != null ? String(e.PCS_WASTAGE)    : "",
              looseOil:      e.LOOSE_OIL      != null ? String(e.LOOSE_OIL)      : "",
            };
          }
        }
      }

      if (itemsData.success) {
        setEntries(
          itemsData.data.map((item: MstItem) => ({
            itmcd:         item.itmcd,
            itmnm:         item.itmnm,
            itmsubcat:     item.itmsubcat,
            cartonWastage: savedMap[item.itmcd]?.cartonWastage ?? "",
            pcsWastage:    savedMap[item.itmcd]?.pcsWastage    ?? "",
            looseOil:      savedMap[item.itmcd]?.looseOil      ?? "",
          }))
        );
      }
    } catch {
      Alert.alert("Error", "Failed to load data. Check your connection.");
    } finally {
      setLoading(false);
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

  const reloadToday = async (supId: string) => {
    try {
      const todayRes  = await fetch(`${API_URL}/wastage/today-entries?supervisorId=${supId}`);
      const todayData = await todayRes.json();
      if (!todayData.success) return;

      const savedMap: Record<string, { cartonWastage: string; pcsWastage: string; looseOil: string }> = {};
      for (const e of todayData.data) {
        if (!savedMap[e.ITMCD]) {
          savedMap[e.ITMCD] = {
            cartonWastage: e.CARTON_WASTAGE != null ? String(e.CARTON_WASTAGE) : "",
            pcsWastage:    e.PCS_WASTAGE    != null ? String(e.PCS_WASTAGE)    : "",
            looseOil:      e.LOOSE_OIL      != null ? String(e.LOOSE_OIL)      : "",
          };
        }
      }

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
        body: JSON.stringify({ doneBy: supervisorId, entries }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        Alert.alert("Saved", `${data.data.count} entries saved.`);
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
            <Text style={styles.topBarSub}>{dateLabel}</Text>
          </View>
          <View style={styles.progressPill}>
            <Text style={styles.progressPillText}>
              {touchedCount}/{entries.length}
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