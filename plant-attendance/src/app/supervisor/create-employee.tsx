import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { API_URL } from "../../constants/config";
import { C } from "../../constants/theme";

type EmpType = "INDIVIDUAL" | "SUPERVISOR";

type FormState = {
  EMPNAME: string;
  EMPFNAME: string;
  EMPDESG: string;
  EMPTYPE: EmpType;
};

const DESIGNATIONS = [
  "Plant Manager",
  "Shift Supervisor",
  "Machine Operator",
  "Quality Inspector",
  "Maintenance Engineer",
  "Safety Officer",
  "Production Worker",
  "Line Leader",
  "Foreman",
  "Helper",
];

export default function CreateEmployeeScreen() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({
    EMPNAME: "",
    EMPFNAME: "",
    EMPDESG: "",
    EMPTYPE: "INDIVIDUAL",
  });
  const [showDesgPicker, setShowDesgPicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Partial<FormState>>({});

  const validate = () => {
    const e: Partial<FormState> = {};
    if (!form.EMPNAME.trim()) e.EMPNAME = "First name is required";
    if (!form.EMPFNAME.trim()) e.EMPFNAME = "Last name is required";
    if (!form.EMPDESG.trim()) e.EMPDESG = "Designation is required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/employees/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          EMPNAME: form.EMPNAME.trim(),
          EMPFNAME: form.EMPFNAME.trim(),
          EMPDESG: form.EMPDESG.trim(),
          EMPTYPE: form.EMPTYPE,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        Alert.alert(
          "Employee Created",
          `${form.EMPNAME} ${form.EMPFNAME} has been added.`,
          [
            {
              text: "Add Another",
              onPress: () => {
                setForm({ EMPNAME: "", EMPFNAME: "", EMPDESG: "", EMPTYPE: "INDIVIDUAL" });
                setErrors({});
              },
            },
            { text: "Done", onPress: () => router.back() },
          ]
        );
      } else {
        Alert.alert("Error", data.message || "Failed to create employee");
      }
    } catch {
      Alert.alert("Error", "Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        {/* Top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color={C.textPrimary} />
          </TouchableOpacity>
          <View>
            <Text style={styles.topBarTitle}>Create Employee</Text>
            <Text style={styles.topBarSub}>Add a new team member</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Preview card */}
          <View style={styles.previewCard}>
            <View style={styles.previewAvatar}>
              {form.EMPNAME ? (
                <Text style={styles.previewAvatarText}>
                  {(form.EMPNAME[0] ?? "").toUpperCase()}
                  {(form.EMPFNAME[0] ?? "").toUpperCase()}
                </Text>
              ) : (
                <Ionicons name="person-outline" size={28} color={C.textMuted} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.previewName}>
                {form.EMPNAME || form.EMPFNAME
                  ? `${form.EMPNAME} ${form.EMPFNAME}`.trim()
                  : "New Employee"}
              </Text>
              <Text style={styles.previewDesg}>{form.EMPDESG || "Designation"}</Text>
              <View
                style={[
                  styles.previewTypePill,
                  form.EMPTYPE === "SUPERVISOR" ? styles.pillSupervisor : styles.pillIndividual,
                ]}
              >
                <Text
                  style={[
                    styles.previewTypeText,
                    form.EMPTYPE === "SUPERVISOR"
                      ? styles.pillTextSupervisor
                      : styles.pillTextIndividual,
                  ]}
                >
                  {form.EMPTYPE === "SUPERVISOR" ? "Supervisor" : "Individual"}
                </Text>
              </View>
            </View>
          </View>

          {/* Section: Personal Info */}
          <Text style={styles.sectionLabel}>Personal Information</Text>

          <View style={styles.fieldGroup}>
            {/* First Name */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>First Name</Text>
              <TextInput
                style={[styles.input, errors.EMPNAME && styles.inputError]}
                placeholder="e.g. Rajesh"
                placeholderTextColor={C.textMuted}
                value={form.EMPNAME}
                onChangeText={(t) => setField("EMPNAME", t)}
                autoCapitalize="words"
                returnKeyType="next"
              />
              {errors.EMPNAME && (
                <Text style={styles.errorText}>{errors.EMPNAME}</Text>
              )}
            </View>

            {/* Last Name */}
            <View style={[styles.field, { borderBottomWidth: 0 }]}>
              <Text style={styles.fieldLabel}>Last Name / Father's Name</Text>
              <TextInput
                style={[styles.input, errors.EMPFNAME && styles.inputError]}
                placeholder="e.g. Kumar"
                placeholderTextColor={C.textMuted}
                value={form.EMPFNAME}
                onChangeText={(t) => setField("EMPFNAME", t)}
                autoCapitalize="words"
                returnKeyType="next"
              />
              {errors.EMPFNAME && (
                <Text style={styles.errorText}>{errors.EMPFNAME}</Text>
              )}
            </View>
          </View>

          {/* Section: Role */}
          <Text style={styles.sectionLabel}>Role & Designation</Text>

          <View style={styles.fieldGroup}>
            {/* Designation */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Designation</Text>
              <TouchableOpacity
                style={[styles.input, styles.selectInput, errors.EMPDESG && styles.inputError]}
                onPress={() => setShowDesgPicker(!showDesgPicker)}
              >
                <Text style={[styles.selectText, !form.EMPDESG && { color: C.textMuted }]}>
                  {form.EMPDESG || "Select designation"}
                </Text>
                <Ionicons
                  name={showDesgPicker ? "chevron-up" : "chevron-down"}
                  size={16}
                  color={C.textMuted}
                />
              </TouchableOpacity>
              {errors.EMPDESG && (
                <Text style={styles.errorText}>{errors.EMPDESG}</Text>
              )}

              {showDesgPicker && (
                <View style={styles.picker}>
                  {DESIGNATIONS.map((d) => (
                    <TouchableOpacity
                      key={d}
                      style={[
                        styles.pickerItem,
                        form.EMPDESG === d && styles.pickerItemActive,
                      ]}
                      onPress={() => {
                        setField("EMPDESG", d);
                        setShowDesgPicker(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.pickerItemText,
                          form.EMPDESG === d && styles.pickerItemTextActive,
                        ]}
                      >
                        {d}
                      </Text>
                      {form.EMPDESG === d && (
                        <Ionicons name="checkmark" size={16} color={C.primary} />
                      )}
                    </TouchableOpacity>
                  ))}

                  <View style={styles.pickerCustomRow}>
                    <TextInput
                      style={styles.pickerCustomInput}
                      placeholder="Or type custom..."
                      placeholderTextColor={C.textMuted}
                      value={DESIGNATIONS.includes(form.EMPDESG) ? "" : form.EMPDESG}
                      onChangeText={(t) => setField("EMPDESG", t)}
                      onSubmitEditing={() => setShowDesgPicker(false)}
                    />
                  </View>
                </View>
              )}
            </View>

            {/* Employee Type */}
            <View style={[styles.field, { borderBottomWidth: 0 }]}>
              <Text style={styles.fieldLabel}>Employee Type</Text>
              <View style={styles.typeToggle}>
                <TouchableOpacity
                  style={[
                    styles.typeBtn,
                    form.EMPTYPE === "INDIVIDUAL" && styles.typeBtnActive,
                  ]}
                  onPress={() => setField("EMPTYPE", "INDIVIDUAL")}
                >
                  <Ionicons
                    name="person-outline"
                    size={18}
                    color={form.EMPTYPE === "INDIVIDUAL" ? C.primary : C.textMuted}
                  />
                  <Text
                    style={[
                      styles.typeBtnText,
                      form.EMPTYPE === "INDIVIDUAL" && styles.typeBtnTextActive,
                    ]}
                  >
                    Individual
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.typeBtn,
                    form.EMPTYPE === "SUPERVISOR" && styles.typeBtnActive,
                  ]}
                  onPress={() => setField("EMPTYPE", "SUPERVISOR")}
                >
                  <Ionicons
                    name="shield-checkmark-outline"
                    size={18}
                    color={form.EMPTYPE === "SUPERVISOR" ? C.primary : C.textMuted}
                  />
                  <Text
                    style={[
                      styles.typeBtnText,
                      form.EMPTYPE === "SUPERVISOR" && styles.typeBtnTextActive,
                    ]}
                  >
                    Supervisor
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.typeHint}>
                {form.EMPTYPE === "SUPERVISOR"
                  ? "Can mark attendance for all employees and access reports."
                  : "Can only mark their own attendance."}
              </Text>
            </View>
          </View>

          {/* Info box */}
          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={18} color={C.primary} />
            <Text style={styles.infoText}>
              After creation, the employee must open the app on their device and register using their name to link their device.
            </Text>
          </View>

          {/* Submit */}
          <TouchableOpacity
            style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color={C.textInverse} />
            ) : (
              <>
                <Ionicons name="person-add-outline" size={20} color={C.textInverse} />
                <Text style={styles.submitBtnText}>Create Employee</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.pageBg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.cardBg,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.inputBg,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.border,
  },
  topBarTitle: { color: C.textPrimary, fontSize: 16, fontWeight: "800", textAlign: "center" },
  topBarSub: { color: C.textMuted, fontSize: 12, textAlign: "center", marginTop: 1 },

  scroll: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 },

  previewCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    backgroundColor: C.cardBg,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 28,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 2,
  },
  previewAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: C.primaryLight,
    borderWidth: 1.5,
    borderColor: C.primaryMuted,
    justifyContent: "center",
    alignItems: "center",
  },
  previewAvatarText: { color: C.primary, fontSize: 20, fontWeight: "800" },
  previewName: { color: C.textPrimary, fontSize: 17, fontWeight: "800", marginBottom: 3 },
  previewDesg: { color: C.textMuted, fontSize: 13, marginBottom: 8 },
  previewTypePill: {
    alignSelf: "flex-start",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
  },
  pillIndividual: { backgroundColor: C.inputBg, borderColor: C.border },
  pillSupervisor: { backgroundColor: C.primaryLight, borderColor: C.primaryMuted },
  previewTypeText: { fontSize: 11, fontWeight: "700" },
  pillTextIndividual: { color: C.textMuted },
  pillTextSupervisor: { color: C.primary },

  sectionLabel: {
    color: C.textMuted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  fieldGroup: {
    backgroundColor: C.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 24,
    overflow: "hidden",
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 3,
    elevation: 1,
  },
  field: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  fieldLabel: {
    color: C.textMuted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  input: {
    backgroundColor: C.inputBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: C.textPrimary,
    fontSize: 15,
  },
  inputError: { borderColor: C.red },
  errorText: { color: C.red, fontSize: 12, marginTop: 6 },

  selectInput: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  selectText: { color: C.textPrimary, fontSize: 15 },

  picker: {
    backgroundColor: C.inputBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    marginTop: 8,
    overflow: "hidden",
  },
  pickerItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  pickerItemActive: { backgroundColor: C.primaryLight },
  pickerItemText: { color: C.textSecondary, fontSize: 14 },
  pickerItemTextActive: { color: C.primary, fontWeight: "700" },
  pickerCustomRow: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  pickerCustomInput: {
    color: C.textPrimary,
    fontSize: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },

  typeToggle: {
    flexDirection: "row",
    gap: 10,
  },
  typeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: C.inputBg,
    borderRadius: 10,
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: C.border,
  },
  typeBtnActive: {
    backgroundColor: C.primaryLight,
    borderColor: C.primary,
  },
  typeBtnText: { color: C.textMuted, fontSize: 14, fontWeight: "700" },
  typeBtnTextActive: { color: C.primary },
  typeHint: { color: C.textMuted, fontSize: 12, marginTop: 10, lineHeight: 16 },

  infoBox: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: C.primaryLight,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: C.primaryMuted,
    marginBottom: 24,
    alignItems: "flex-start",
  },
  infoText: { color: C.textSecondary, fontSize: 13, lineHeight: 18, flex: 1 },

  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.primary,
    borderRadius: 16,
    paddingVertical: 18,
    gap: 10,
  },
  submitBtnDisabled: { backgroundColor: C.primaryMuted },
  submitBtnText: { color: C.textInverse, fontSize: 17, fontWeight: "800" },
});