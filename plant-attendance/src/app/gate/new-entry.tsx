import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useState } from "react";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { C } from "../../constants/theme";

type EntryType = "PERSON" | "VEHICLE";

export default function GateNewEntryScreen() {
  const router = useRouter();
  const [entryType, setEntryType] = useState<EntryType>("PERSON");
  const [name, setName]           = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [purpose, setPurpose]     = useState("");

  const canContinue =
    name.trim().length > 0 &&
    purpose.trim().length > 0 &&
    (entryType === "PERSON" || vehicleNo.trim().length > 0);

  const handleContinue = () => {
    if (!canContinue) {
      Alert.alert(
        "Missing details",
        entryType === "VEHICLE"
          ? "Driver name, vehicle number, and purpose are all required."
          : "Name and purpose are both required."
      );
      return;
    }
    router.push({
      pathname: "/gate/capture",
      params: {
        entryType,
        name:      name.trim(),
        vehicleNo: entryType === "VEHICLE" ? vehicleNo.trim() : "",
        purpose:   purpose.trim(),
      },
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={C.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>New Entry</Text>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Entry Type</Text>
          <View style={styles.typeRow}>
            <TouchableOpacity
              style={[styles.typeBtn, entryType === "PERSON" && styles.typeBtnActive]}
              onPress={() => setEntryType("PERSON")}
            >
              <Ionicons name="person-outline" size={18} color={entryType === "PERSON" ? C.textInverse : C.textSecondary} />
              <Text style={[styles.typeBtnText, entryType === "PERSON" && styles.typeBtnTextActive]}>Person</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.typeBtn, entryType === "VEHICLE" && styles.typeBtnActive]}
              onPress={() => setEntryType("VEHICLE")}
            >
              <Ionicons name="car-outline" size={18} color={entryType === "VEHICLE" ? C.textInverse : C.textSecondary} />
              <Text style={[styles.typeBtnText, entryType === "VEHICLE" && styles.typeBtnTextActive]}>Vehicle</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>{entryType === "VEHICLE" ? "Driver Name" : "Name"}</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={entryType === "VEHICLE" ? "Driver's name" : "Visitor's name"}
            placeholderTextColor={C.textMuted}
            style={styles.input}
          />

          {entryType === "VEHICLE" && (
            <>
              <Text style={styles.label}>Vehicle Number</Text>
              <TextInput
                value={vehicleNo}
                onChangeText={setVehicleNo}
                placeholder="e.g. UP80 AB 1234"
                placeholderTextColor={C.textMuted}
                autoCapitalize="characters"
                style={styles.input}
              />
            </>
          )}

          <Text style={styles.label}>Purpose of Visit</Text>
          <TextInput
            value={purpose}
            onChangeText={setPurpose}
            placeholder="e.g. Material delivery, maintenance visit"
            placeholderTextColor={C.textMuted}
            style={[styles.input, styles.inputMultiline]}
            multiline
          />
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.continueBtn, !canContinue && styles.continueBtnDisabled]}
            onPress={handleContinue}
            disabled={!canContinue}
          >
            <Ionicons name="camera-outline" size={20} color={C.textInverse} />
            <Text style={styles.continueBtnText}>Continue to Photo</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.pageBg },
  flex: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.cardBg, borderWidth: 1, borderColor: C.border,
    justifyContent: "center", alignItems: "center",
  },
  headerTitle: { color: C.textPrimary, fontSize: 19, fontWeight: "800", letterSpacing: -0.3 },
  content: { paddingHorizontal: 20, paddingBottom: 24 },
  label: { color: C.textSecondary, fontSize: 13, fontWeight: "700", marginBottom: 8, marginTop: 18 },
  typeRow: { flexDirection: "row", gap: 10 },
  typeBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 14, borderRadius: 12, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.cardBg,
  },
  typeBtnActive: { backgroundColor: C.primary, borderColor: C.primary },
  typeBtnText: { color: C.textSecondary, fontSize: 14, fontWeight: "700" },
  typeBtnTextActive: { color: C.textInverse },
  input: {
    backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, color: C.textPrimary,
  },
  inputMultiline: { minHeight: 80, textAlignVertical: "top" },
  footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 },
  continueBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    backgroundColor: C.primary, borderRadius: 16, paddingVertical: 18,
  },
  continueBtnDisabled: { opacity: 0.5 },
  continueBtnText: { color: C.textInverse, fontSize: 16, fontWeight: "800" },
});