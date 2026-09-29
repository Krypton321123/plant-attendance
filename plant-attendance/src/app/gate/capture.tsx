import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRef, useState } from "react";
import { useRouter, useLocalSearchParams } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_URL, STORAGE_KEYS } from "../../constants/config";
import { C } from "../../constants/theme";
import { fetch } from "expo/fetch";

export default function GateCaptureScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    entryType: string;
    name: string;
    vehicleNo: string;
    purpose: string;
  }>();

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const takePhoto = async () => {
    if (!cameraRef.current) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.5 });
      if (photo?.uri) setPhotoUri(photo.uri);
    } catch {
      Alert.alert("Error", "Couldn't capture photo. Try again.");
    } finally {
      setCapturing(false);
    }
  };

  const retake = () => setPhotoUri(null);

  const submit = async () => {
    if (!photoUri) return;
    setSubmitting(true);
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.EMPLOYEE);
      const guard = raw ? JSON.parse(raw) : null;
      if (!guard?.EMP_ID) {
        Alert.alert("Error", "Couldn't identify guard. Please log in again.");
        return;
      }

      await new Promise<void>((resolve, reject) => {
        const fd = new FormData();
        // Text fields MUST be appended before the photo file. multer parses
        // the multipart stream in order, so destination/filename callbacks on
        // the backend only see req.body fields that arrived earlier in the
        // stream than the file part.
        fd.append("entryType", params.entryType);
        fd.append("name", params.name);
        if (params.entryType === "VEHICLE")
          fd.append("vehicleNo", params.vehicleNo);
        fd.append("purpose", params.purpose);
        fd.append("loggedBy", guard.EMP_ID);
        fd.append("photo", {
          uri: photoUri,
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

          if (xhr.status >= 200 && xhr.status < 300) {
            router.replace("/gate/home");
            resolve();
          } else {
            Alert.alert("Error", data.message || "Failed to log entry");
            reject(new Error(data.message));
          }
        };

        xhr.onerror = () => {
          Alert.alert("Error", "Network error. Try again.");
          reject(new Error("Network error"));
        };

        xhr.send(fd);
      });
    } catch {
      // already alerted above
    } finally {
      setSubmitting(false);
    }
  };

  if (!permission) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator
          size="large"
          color={C.primary}
          style={{ marginTop: 80 }}
        />
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionBox}>
          <Ionicons name="camera-outline" size={40} color={C.textMuted} />
          <Text style={styles.permissionText}>
            Camera access is needed to log a gate entry.
          </Text>
          <TouchableOpacity
            style={styles.permissionBtn}
            onPress={requestPermission}
          >
            <Text style={styles.permissionBtnText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {photoUri ? "Confirm Photo" : "Take Photo"}
        </Text>
      </View>

      <View style={styles.cameraWrap}>
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.preview} />
        ) : (
          <CameraView ref={cameraRef} style={styles.preview} facing="back" />
        )}
      </View>

      <View style={styles.controls}>
        {photoUri ? (
          <>
            <TouchableOpacity
              style={styles.retakeBtn}
              onPress={retake}
              disabled={submitting}
            >
              <Ionicons name="refresh-outline" size={20} color="#E2E8F0" />
              <Text style={styles.retakeBtnText}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.submitBtn}
              onPress={submit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color={C.textInverse} />
              ) : (
                <>
                  <Ionicons
                    name="checkmark-circle-outline"
                    size={20}
                    color={C.textInverse}
                  />
                  <Text style={styles.submitBtnText}>Log Entry</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={styles.shutterBtn}
            onPress={takePhoto}
            disabled={capturing}
          >
            {capturing ? (
              <ActivityIndicator color={C.textInverse} />
            ) : (
              <View style={styles.shutterInner} />
            )}
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

// This screen intentionally uses a dark background regardless of the app's
// light theme (C.pageBg etc.) — full-screen camera viewfinders read better
// with dark surrounding chrome, which is why it departs from the token set
// used everywhere else. Accent colors (C.primary, C.textInverse) still come
// from the shared theme so the buttons stay visually consistent with the
// rest of the app.
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.1)",
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: { color: "#fff", fontSize: 17, fontWeight: "700" },
  cameraWrap: {
    flex: 1,
    marginHorizontal: 20,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  preview: { flex: 1 },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingVertical: 28,
    paddingHorizontal: 20,
  },
  shutterBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: C.primary,
    borderWidth: 4,
    borderColor: "rgba(255,255,255,0.3)",
    justifyContent: "center",
    alignItems: "center",
  },
  shutterInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: C.textInverse,
  },
  retakeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  retakeBtnText: { color: "#E2E8F0", fontSize: 15, fontWeight: "700" },
  submitBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: C.primary,
  },
  submitBtnText: { color: C.textInverse, fontSize: 15, fontWeight: "700" },
  permissionBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 14,
  },
  permissionText: { color: C.textMuted, fontSize: 14, textAlign: "center" },
  permissionBtn: {
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  permissionBtnText: { color: C.textInverse, fontSize: 14, fontWeight: "700" },
});
