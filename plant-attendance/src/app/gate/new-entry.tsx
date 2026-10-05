import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRef, useState } from "react";
import { useRouter } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_URL, STORAGE_KEYS } from "../../constants/config";
import { C } from "../../constants/theme";

type EntryType = "EMPLOYEE" | "VISITOR";

const ENTRY_TYPES: {
  value: EntryType;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { value: "EMPLOYEE", label: "Employee", icon: "briefcase-outline" },
  { value: "VISITOR",  label: "Visitor",  icon: "people-outline" },
];

export default function GateNewEntryScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);

  const [entryType,    setEntryType]    = useState<EntryType>("EMPLOYEE");
  const [name,         setName]         = useState("");
  const [personToMeet, setPersonToMeet] = useState("");
  const [purpose,      setPurpose]      = useState("");
  const [mobile,       setMobile]       = useState("");
  const [vehicleNo,    setVehicleNo]    = useState("");

  const [photo,      setPhoto]      = useState<string | null>(null);
  const [capturing,  setCapturing]  = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isVisitor = entryType === "VISITOR";

  const takePhoto = async () => {
    if (!cameraRef.current) return;
    setCapturing(true);
    try {
      const shot = await cameraRef.current.takePictureAsync({ quality: 0.5 });
      if (shot?.uri) setPhoto(shot.uri);
    } catch {
      Alert.alert("Error", "Couldn't capture photo. Try again.");
    } finally {
      setCapturing(false);
    }
  };

  // Checked in on-screen order, so the first thing flagged is the first thing
  // missing. Vehicle number is optional and never validated.
  const validate = (): string | null => {
    if (!name.trim()) return isVisitor ? "Visitor name is required" : "Name is required";
    if (isVisitor && !personToMeet.trim()) return "Person to meet is required";
    if (!purpose.trim()) return "Purpose is required";
    if (isVisitor && !/^\d{10}$/.test(mobile.trim())) return "Enter a valid 10-digit mobile number";
    if (!photo) return "Take a photo before submitting";
    return null;
  };

  const sendEntry = (guardId: string) =>
    new Promise<void>((resolve, reject) => {
      const fd = new FormData();
      // Text fields MUST be appended before the photo file. multer parses
      // the multipart stream in order, so destination/filename callbacks on
      // the backend only see req.body fields that arrived earlier in the
      // stream than the file part.
      fd.append("entryType", entryType);
      fd.append("name", name.trim());
      if (isVisitor) {
        fd.append("personToMeet", personToMeet.trim());
        fd.append("mobile", mobile.trim());
        if (vehicleNo.trim()) fd.append("vehicleNo", vehicleNo.trim());
      }
      fd.append("purpose", purpose.trim());
      fd.append("loggedBy", guardId);
      fd.append("photo", {
        uri: photo,
        name: `gate_${Date.now()}.jpg`,
        type: "image/jpeg",
      } as any);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_URL}/gate/entry`);
      xhr.setRequestHeader("Accept", "application/json");

      xhr.onload = () => {
        let data: any = {};
        try {
          data = JSON.parse(xhr.responseText);
        } catch {}

        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(data.message || "Failed to log entry"));
      };
      xhr.onerror = () => reject(new Error("Network error. Try again."));

      xhr.send(fd);
    });

  const submit = async () => {
    const validationError = validate();
    if (validationError) {
      Alert.alert("Missing info", validationError);
      return;
    }

    setSubmitting(true);
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.EMPLOYEE);
      const guard = raw ? JSON.parse(raw) : null;
      if (!guard?.EMP_ID) {
        Alert.alert("Error", "Couldn't identify guard. Please log in again.");
        return;
      }

      await sendEntry(guard.EMP_ID);

      // This screen is pushed on top of the gate log, so going back lands on
      // it and its focus effect reloads the list with the new entry.
      if (router.canGoBack()) router.back();
      else router.replace("/gate/home");
    } catch (err: any) {
      Alert.alert("Error", err?.message || "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  // Same permission → live camera → preview/retake flow as the sign-up screen.
  const renderPhotoSection = () => {
    if (!permission) return <View style={styles.cameraContainer} />;

    if (!permission.granted) {
      return (
        <View style={styles.permBox}>
          <Ionicons name="camera-outline" size={28} color={C.primary} />
          <Text style={styles.permText}>Camera access is needed to log a gate entry</Text>
          <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
            <Text style={styles.permBtnText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (!photo) {
      return (
        <>
          <View style={styles.cameraContainer}>
            <CameraView ref={cameraRef} style={styles.camera} facing="back" />
          </View>
          <TouchableOpacity style={styles.shutterBtn} onPress={takePhoto} disabled={capturing}>
            {capturing ? (
              <ActivityIndicator color={C.primary} />
            ) : (
              <View style={styles.shutterInner} />
            )}
          </TouchableOpacity>
        </>
      );
    }

    return (
      <>
        <View style={styles.cameraContainer}>
          <Image source={{ uri: photo }} style={styles.camera} />
        </View>
        <TouchableOpacity
          style={styles.retakeBtn}
          onPress={() => setPhoto(null)}
          disabled={submitting}
        >
          <Ionicons name="refresh" size={16} color={C.textSecondary} />
          <Text style={styles.retakeBtnText}>Retake</Text>
        </TouchableOpacity>
      </>
    );
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
            {ENTRY_TYPES.map((t) => {
              const active = entryType === t.value;
              return (
                <TouchableOpacity
                  key={t.value}
                  style={[styles.typeBtn, active && styles.typeBtnActive]}
                  onPress={() => setEntryType(t.value)}
                >
                  <Ionicons name={t.icon} size={18} color={active ? C.textInverse : C.textSecondary} />
                  <Text style={[styles.typeBtnText, active && styles.typeBtnTextActive]}>{t.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>{isVisitor ? "Visitor Name" : "Name"}</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={isVisitor ? "Visitor's name" : "Employee's name"}
            placeholderTextColor={C.textMuted}
            style={styles.input}
          />

          {isVisitor && (
            <>
              <Text style={styles.label}>Person to Meet</Text>
              <TextInput
                value={personToMeet}
                onChangeText={setPersonToMeet}
                placeholder="Who is the visitor here to see?"
                placeholderTextColor={C.textMuted}
                style={styles.input}
              />
            </>
          )}

          <Text style={styles.label}>{isVisitor ? "Purpose of Visit" : "Purpose"}</Text>
          <TextInput
            value={purpose}
            onChangeText={setPurpose}
            placeholder={isVisitor ? "e.g. Material delivery, maintenance visit" : "Reason for entry"}
            placeholderTextColor={C.textMuted}
            style={[styles.input, styles.inputMultiline]}
            multiline
          />

          {isVisitor && (
            <>
              <Text style={styles.label}>Mobile Number</Text>
              <TextInput
                value={mobile}
                onChangeText={(t) => setMobile(t.replace(/[^0-9]/g, "").slice(0, 10))}
                placeholder="10-digit mobile number"
                placeholderTextColor={C.textMuted}
                keyboardType="number-pad"
                maxLength={10}
                style={styles.input}
              />

              <Text style={styles.label}>Vehicle Number (Optional)</Text>
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

          <Text style={styles.label}>Photo</Text>
          {renderPhotoSection()}

          <TouchableOpacity
            style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
            onPress={submit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color={C.textInverse} />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={20} color={C.textInverse} />
                <Text style={styles.submitBtnText}>Log Entry</Text>
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
  content: { paddingHorizontal: 20, paddingBottom: 48 },
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

  // Photo section — same look as the sign-up screen
  cameraContainer: {
    marginTop: 4, borderRadius: 16, overflow: "hidden",
    aspectRatio: 3 / 4, backgroundColor: C.border,
  },
  camera: { flex: 1 },
  permBox: {
    marginTop: 4, borderRadius: 16, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.cardBg, paddingVertical: 32, alignItems: "center", gap: 10,
  },
  permText: { color: C.textSecondary, fontSize: 13, textAlign: "center", paddingHorizontal: 20 },
  permBtn: {
    backgroundColor: C.primary, borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 20, marginTop: 4,
  },
  permBtnText: { color: C.textInverse, fontWeight: "700", fontSize: 13 },
  shutterBtn: {
    alignSelf: "center", marginTop: 20, width: 60, height: 60, borderRadius: 30,
    borderWidth: 3, borderColor: C.primary, justifyContent: "center", alignItems: "center",
  },
  shutterInner: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.primary },
  retakeBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", alignSelf: "center",
    marginTop: 14, gap: 6, paddingVertical: 8, paddingHorizontal: 16,
    borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.cardBg,
  },
  retakeBtnText: { color: C.textSecondary, fontSize: 13, fontWeight: "600" },

  submitBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    backgroundColor: C.primary, borderRadius: 16, paddingVertical: 18, marginTop: 32,
  },
  submitBtnDisabled: { opacity: 0.7 },
  submitBtnText: { color: C.textInverse, fontSize: 16, fontWeight: "800" },
});