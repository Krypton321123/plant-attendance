import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRef, useState } from "react";
import { CameraView, CameraType, useCameraPermissions } from "expo-camera";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { API_URL } from "../../constants/config";
import { getOrCreateDeviceId } from "../../util/deviceid";
import { C } from "../../constants/theme";

export default function SignupScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [facing] = useState<CameraType>("front");
  const cameraRef = useRef<CameraView | null>(null);

  const [empName, setEmpName] = useState("");
  const [empFName, setEmpFName] = useState("");
  const [mobile, setMobile] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const takePicture = async () => {
    const data = await cameraRef.current?.takePictureAsync({ quality: 0.8 });
    if (data) setPhoto(data.uri);
  };

  const validate = (): string | null => {
    if (!empName.trim()) return "Name is required";
    if (!empFName.trim()) return "Father's name is required";
    if (!/^\d{10}$/.test(mobile.trim())) return "Enter a valid 10-digit mobile number";
    if (!photo) return "Take a photo before submitting";
    return null;
  };

  const handleSubmit = async () => {
    const validationError = validate();
    if (validationError) {
      Alert.alert("Missing info", validationError);
      return;
    }

    setSubmitting(true);
    try {
      const deviceId = await getOrCreateDeviceId();

      await new Promise<void>((resolve, reject) => {
        const formData = new FormData();
        formData.append("empName", empName.trim());
        formData.append("empFName", empFName.trim());
        formData.append("mobile", mobile.trim());
        formData.append("deviceId", deviceId);
        formData.append("photo", {
          uri: photo,
          type: "image/jpeg",
          name: `signup_${Date.now()}.jpg`,
        } as any);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${API_URL}/auth/signup`);
        xhr.setRequestHeader("Accept", "application/json");

        xhr.onload = () => {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) {
            Alert.alert(
              "Submitted",
              "Your sign up has been received. An admin will assign your PIN — you'll use it to log in once it's ready.",
              [{ text: "OK", onPress: () => router.replace("/") }]
            );
            resolve();
          } else {
            Alert.alert("Error", data.message || "Sign up failed");
            reject(new Error(data.message));
          }
        };

        xhr.onerror = () => {
          Alert.alert("Error", "Network error. Try again.");
          reject(new Error("Network error"));
        };
        xhr.send(formData);
      });
    } catch {
      // already alerted above
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color={C.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Sign Up</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            placeholder="Your first name"
            placeholderTextColor={C.textMuted}
            value={empName}
            onChangeText={setEmpName}
          />

          <Text style={styles.label}>Father's Name</Text>
          <TextInput
            style={styles.input}
            placeholder="Father's name"
            placeholderTextColor={C.textMuted}
            value={empFName}
            onChangeText={setEmpFName}
          />

          <Text style={styles.label}>Mobile Number</Text>
          <TextInput
            style={styles.input}
            placeholder="10-digit mobile number"
            placeholderTextColor={C.textMuted}
            value={mobile}
            onChangeText={(t) => setMobile(t.replace(/[^0-9]/g, "").slice(0, 10))}
            keyboardType="number-pad"
            maxLength={10}
          />

          <Text style={styles.label}>Photo</Text>
          {!permission ? (
            <View style={styles.cameraContainer} />
          ) : !permission.granted ? (
            <View style={styles.permBox}>
              <Ionicons name="camera-outline" size={28} color={C.primary} />
              <Text style={styles.permText}>Camera access is needed for your photo</Text>
              <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
                <Text style={styles.permBtnText}>Grant Permission</Text>
              </TouchableOpacity>
            </View>
          ) : !photo ? (
            <>
              <View style={styles.cameraContainer}>
                <CameraView style={styles.camera} ref={cameraRef} facing={facing} />
              </View>
              <TouchableOpacity style={styles.shutterBtn} onPress={takePicture}>
                <View style={styles.shutterInner} />
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.cameraContainer}>
                <Image source={{ uri: photo }} style={styles.camera} />
              </View>
              <TouchableOpacity style={styles.retakeBtn} onPress={() => setPhoto(null)}>
                <Ionicons name="refresh" size={16} color={C.textSecondary} />
                <Text style={styles.retakeBtnText}>Retake</Text>
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity
            style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color={C.textInverse} />
            ) : (
              <>
                <Text style={styles.submitBtnText}>Submit</Text>
                <Ionicons name="arrow-forward" size={18} color={C.textInverse} />
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
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: C.inputBg,
    borderWidth: 1,
    borderColor: C.border,
    justifyContent: "center",
    alignItems: "center",
  },
  topBarTitle: { color: C.textPrimary, fontSize: 16, fontWeight: "700" },
  scrollContent: { padding: 24, paddingBottom: 48 },
  label: {
    color: C.textSecondary,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
    marginTop: 18,
  },
  input: {
    backgroundColor: C.cardBg,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
    color: C.textPrimary,
    fontSize: 15,
  },
  cameraContainer: {
    marginTop: 4,
    borderRadius: 16,
    overflow: "hidden",
    aspectRatio: 3 / 4,
    backgroundColor: C.border,
  },
  camera: { flex: 1 },
  permBox: {
    marginTop: 4,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.cardBg,
    paddingVertical: 32,
    alignItems: "center",
    gap: 10,
  },
  permText: { color: C.textSecondary, fontSize: 13, textAlign: "center", paddingHorizontal: 20 },
  permBtn: {
    backgroundColor: C.primary,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 20,
    marginTop: 4,
  },
  permBtnText: { color: C.textInverse, fontWeight: "700", fontSize: 13 },
  shutterBtn: {
    alignSelf: "center",
    marginTop: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 3,
    borderColor: C.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  shutterInner: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.primary },
  retakeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginTop: 14,
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.cardBg,
  },
  retakeBtnText: { color: C.textSecondary, fontSize: 13, fontWeight: "600" },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.primary,
    borderRadius: 14,
    paddingVertical: 16,
    gap: 8,
    marginTop: 32,
  },
  submitBtnDisabled: { opacity: 0.7 },
  submitBtnText: { color: C.textInverse, fontSize: 15, fontWeight: "800" },
});