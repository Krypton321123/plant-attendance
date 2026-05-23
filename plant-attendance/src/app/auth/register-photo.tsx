import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
  ActivityIndicator,
  Image,
} from "react-native";
import { useRef, useState } from "react";
import { CameraView, CameraType, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { API_URL, STORAGE_KEYS } from "../../constants/config";
import * as Location from "expo-location";

export default function RegisterPhotoScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [facing] = useState<CameraType>("front");
  const [photo, setPhoto] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const cameraRef = useRef<CameraView | null>(null);

  const now = new Date();
  const dateStr = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const takePicture = async () => {
    const data = await cameraRef.current?.takePictureAsync({ quality: 0.8 });
    if (data) setPhoto(data.uri);
  };

  const handleSubmit = async () => {
    if (!photo) return;
    setSubmitting(true);

    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.EMPLOYEE);
      if (!raw) throw new Error("No employee data");
      const employee = JSON.parse(raw);

      await new Promise<void>((resolve, reject) => {
        const formData = new FormData();
        formData.append("empId", employee.EMP_ID);
        formData.append("deviceId", employee.DEVICEID);
        formData.append("photo", {
          uri: photo,
          type: "image/jpeg",
          name: `profile_${Date.now()}.jpg`,
        } as any);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${API_URL}/employees/register`);
        xhr.setRequestHeader("Accept", "application/json");

        xhr.onload = async () => {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) {
            await AsyncStorage.setItem(
              STORAGE_KEYS.EMPLOYEE,
              JSON.stringify({ ...employee, STATUS: "NA" }),
            );
            router.replace("/auth/pending");
            resolve();
          } else {
            Alert.alert("Error", data.message || "Registration failed");
            reject(new Error(data.message));
          }
        };

        xhr.onerror = () => reject(new Error("Network error"));
        xhr.send(formData);
      });
    } catch (err: any) {
      Alert.alert("Error", err.message || "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionBox}>
          <Ionicons name="camera-outline" size={56} color="#444" />
          <Text style={styles.permTitle}>Camera Required</Text>
          <Text style={styles.permSub}>
            We need your camera to take a registration photo.
          </Text>
          <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
            <Text style={styles.permBtnText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Registration Photo</Text>
        <View style={{ width: 24 }} />
      </View>

      <Text style={styles.instruction}>
        Take a clear selfie. This will be used for identity verification.
      </Text>

      {!photo ? (
        <>
          <View style={styles.cameraContainer}>
            <CameraView style={styles.camera} ref={cameraRef} facing={facing}>
              {/* Overlay with name + time */}
              <View style={styles.overlayBottom}>
                <View style={styles.overlayRow}>
                  <Ionicons name="time-outline" size={13} color="#FFF" />
                  <Text style={styles.overlayText}>{dateStr}</Text>
                </View>
              </View>
            </CameraView>
          </View>

          <TouchableOpacity style={styles.shutterBtn} onPress={takePicture}>
            <View style={styles.shutterInner} />
          </TouchableOpacity>
        </>
      ) : (
        <>
          <View style={styles.cameraContainer}>
            <Image source={{ uri: photo }} style={styles.camera} />
            <View style={styles.overlayBottom}>
              <View style={styles.overlayRow}>
                <Ionicons name="time-outline" size={13} color="#FFF" />
                <Text style={styles.overlayText}>{dateStr}</Text>
              </View>
            </View>
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.retakeBtn}
              onPress={() => setPhoto(null)}
            >
              <Ionicons name="refresh" size={20} color="#FFF" />
              <Text style={styles.retakeBtnText}>Retake</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.submitBtn}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#0D0D0D" />
              ) : (
                <>
                  <Ionicons name="checkmark" size={20} color="#0D0D0D" />
                  <Text style={styles.submitBtnText}>Submit</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0D0D0D" },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  topBarTitle: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "700",
  },
  instruction: {
    color: "#666",
    fontSize: 14,
    textAlign: "center",
    marginHorizontal: 40,
    marginBottom: 20,
    lineHeight: 20,
  },
  cameraContainer: {
    marginHorizontal: 24,
    borderRadius: 20,
    overflow: "hidden",
    aspectRatio: 3 / 4,
    backgroundColor: "#111",
    position: "relative",
  },
  camera: { flex: 1 },
  overlayBottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 4,
  },
  overlayRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  overlayText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "500",
  },
  shutterBtn: {
    alignSelf: "center",
    marginTop: 32,
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: "#E8A020",
    justifyContent: "center",
    alignItems: "center",
  },
  shutterInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "#E8A020",
  },
  actionRow: {
    flexDirection: "row",
    marginHorizontal: 24,
    marginTop: 24,
    gap: 12,
  },
  retakeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1A1A1A",
    borderRadius: 14,
    paddingVertical: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: "#2A2A2A",
  },
  retakeBtnText: { color: "#FFF", fontSize: 15, fontWeight: "600" },
  submitBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E8A020",
    borderRadius: 14,
    paddingVertical: 16,
    gap: 8,
  },
  submitBtnText: { color: "#0D0D0D", fontSize: 15, fontWeight: "800" },
  permissionBox: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
    gap: 16,
  },
  permTitle: { color: "#FFF", fontSize: 22, fontWeight: "700" },
  permSub: { color: "#666", fontSize: 14, textAlign: "center", lineHeight: 20 },
  permBtn: {
    backgroundColor: "#E8A020",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  permBtnText: { color: "#0D0D0D", fontWeight: "800", fontSize: 15 },
});
