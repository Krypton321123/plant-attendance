import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,

  Alert,
  ActivityIndicator,
  Image,
} from "react-native";
import { useEffect, useRef, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, CameraType, useCameraPermissions } from "expo-camera";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { captureRef } from "react-native-view-shot";
import { API_URL } from "../../constants/config";
import { getCurrentLocationWithName } from "../../util/Location";
import { C } from "../../constants/theme";

export default function MarkCameraScreen() {
  const router = useRouter();
  const { empId, empName, isSelf } = useLocalSearchParams<{
    empId: string;
    empName: string;
    isSelf: string;
  }>();

  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>(
    isSelf === "true" ? "front" : "back",
  );
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [finalUri, setFinalUri] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [locationName, setLocationName] = useState<string>("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  const cameraRef = useRef<CameraView | null>(null);
  const overlayRef = useRef<View | null>(null);

  const now = new Date();
  const dateStr = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  useEffect(() => {
    fetchLocation();
  }, []);

  const fetchLocation = async () => {
    const result = await getCurrentLocationWithName();
    if (result) {
      setLocationName(result.name);
      setCoords({ lat: result.coords.latitude, lng: result.coords.longitude });
    }
  };

  useEffect(() => {
    if (photoUri) {
      setProcessing(true);
      setTimeout(async () => {
        try {
          if (!overlayRef.current) return;
          const uri = await captureRef(overlayRef, {
            format: "jpg",
            quality: 0.85,
          });
          setFinalUri(uri);
        } catch (e) {
          console.error(e);
          Alert.alert("Error", "Failed to process photo");
        } finally {
          setProcessing(false);
        }
      }, 800);
    }
  }, [photoUri]);

  const takePicture = async () => {
    const data = await cameraRef.current?.takePictureAsync({ quality: 0.85 });
    if (data) setPhotoUri(data.uri);
  };

  const handleUsePhoto = async () => {
    if (!finalUri) return;
    setUploading(true);

    try {
      await new Promise<void>((resolve, reject) => {
        const formData = new FormData();
        formData.append("empId", empId);
        formData.append("status", "P");
        if (locationName) formData.append("location", locationName);
        formData.append("photo", {
          uri: finalUri,
          type: "image/jpeg",
          name: `att_${Date.now()}.jpg`,
        } as any);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${API_URL}/attendance/mark`);
        xhr.setRequestHeader("Accept", "application/json");

        xhr.onload = () => {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) {
            Alert.alert(
              "Success",
              `${empName}'s attendance marked as Present!`,
              [{ text: "OK", onPress: () => router.back() }],
            );
            resolve();
          } else {
            Alert.alert("Error", data.message || "Failed to mark attendance");
            reject(new Error(data.message));
          }
        };

        xhr.onerror = () => reject(new Error("Network error"));
        xhr.send(formData);
      });
    } catch (err: any) {
      Alert.alert("Error", err.message || "Something went wrong");
    } finally {
      setUploading(false);
    }
  };

  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permBox}>
          <View style={styles.permIconWrap}>
            <Ionicons name="camera-outline" size={32} color={C.primary} />
          </View>
          <Text style={styles.permTitle}>Camera Required</Text>
          <Text style={styles.permSub}>We need camera access to mark attendance.</Text>
          <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
            <Text style={styles.permBtnText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const PhotoOverlay = () => (
    <LinearGradient
      colors={["transparent", "rgba(0,0,0,0.75)", "rgba(0,0,0,0.92)"]}
      style={overlayStyles.gradient}
    >
      <View style={overlayStyles.row}>
        <Ionicons name="person-outline" size={13} color="#E8A020" />
        <Text style={overlayStyles.name}>{empName}</Text>
      </View>
      <View style={overlayStyles.row}>
        <Ionicons name="time-outline" size={13} color="#FFF" />
        <Text style={overlayStyles.text}>{dateStr}</Text>
      </View>
      {locationName ? (
        <View style={overlayStyles.row}>
          <Ionicons name="location-outline" size={13} color="#FFF" />
          <Text style={overlayStyles.text} numberOfLines={2}>
            {locationName}
          </Text>
        </View>
      ) : null}
      {coords ? (
        <Text style={overlayStyles.coords}>
          {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
        </Text>
      ) : null}
    </LinearGradient>
  );

  if (photoUri) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => {
              setPhotoUri(null);
              setFinalUri(null);
            }}
          >
            <Ionicons name="arrow-back" size={20} color={C.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.topBarTitle}>Photo Preview</Text>
          <View style={{ width: 36 }} />
        </View>

        <Text style={styles.subLabel}>
          Marking:{" "}
          <Text style={{ color: C.primary, fontWeight: "700" }}>{empName}</Text>
        </Text>

        <View
          style={styles.photoContainer}
          ref={overlayRef}
          collapsable={false}
        >
          <Image
            source={{ uri: photoUri }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
          <PhotoOverlay />
        </View>

        {processing && (
          <View style={styles.processingRow}>
            <ActivityIndicator size="small" color={C.primary} />
            <Text style={styles.processingText}>Processing image...</Text>
          </View>
        )}

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.retakeBtn}
            onPress={() => {
              setPhotoUri(null);
              setFinalUri(null);
            }}
          >
            <Ionicons name="refresh" size={20} color={C.textSecondary} />
            <Text style={styles.retakeBtnText}>Retake</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.useBtn,
              (!finalUri || processing) && styles.useBtnDisabled,
            ]}
            onPress={handleUsePhoto}
            disabled={!finalUri || processing || uploading}
          >
            {uploading ? (
              <ActivityIndicator color={C.textInverse} />
            ) : (
              <>
                <Ionicons name="checkmark" size={20} color={C.textInverse} />
                <Text style={styles.useBtnText}>Mark Present</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color={C.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Take Photo</Text>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => setFacing(facing === "back" ? "front" : "back")}
        >
          <Ionicons name="camera-reverse-outline" size={20} color={C.textPrimary} />
        </TouchableOpacity>
      </View>

      <View style={styles.empLabel}>
        <Ionicons name="person-outline" size={14} color={C.primary} />
        <Text style={styles.empLabelText}>{empName}</Text>
      </View>

      <CameraView style={styles.camera} ref={cameraRef} facing={facing} />

      <View style={styles.shutterArea}>
        {locationName ? (
          <View style={styles.locationChip}>
            <Ionicons name="location-outline" size={13} color={C.textSecondary} />
            <Text style={styles.locationChipText} numberOfLines={1}>
              {locationName}
            </Text>
          </View>
        ) : (
          <ActivityIndicator size="small" color={C.textMuted} />
        )}

        <TouchableOpacity style={styles.shutterBtn} onPress={takePicture}>
          <View style={styles.shutterInner} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const overlayStyles = StyleSheet.create({
  gradient: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 5,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { color: "#E8A020", fontSize: 13, fontWeight: "700" },
  text: { color: "#FFF", fontSize: 12, flex: 1 },
  coords: { color: "rgba(255,255,255,0.5)", fontSize: 10, marginTop: 2 },
});

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
  subLabel: {
    color: C.textSecondary,
    fontSize: 14,
    textAlign: "center",
    marginVertical: 12,
  },
  empLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "center",
    backgroundColor: C.primaryLight,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.primaryMuted,
  },
  empLabelText: { color: C.primary, fontSize: 13, fontWeight: "700" },
  camera: { flex: 1 },
  photoContainer: {
    marginHorizontal: 20,
    borderRadius: 20,
    overflow: "hidden",
    height: 400,
    backgroundColor: C.border,
    position: "relative",
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 4,
  },
  processingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
  },
  processingText: { color: C.textSecondary, fontSize: 13 },
  shutterArea: {
    paddingBottom: 40,
    paddingTop: 20,
    alignItems: "center",
    gap: 16,
    backgroundColor: C.cardBg,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  locationChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: C.inputBg,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    maxWidth: 280,
    borderWidth: 1,
    borderColor: C.border,
  },
  locationChipText: { color: C.textSecondary, fontSize: 12, flex: 1 },
  shutterBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: C.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  shutterInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: C.primary,
  },
  actionRow: {
    flexDirection: "row",
    marginHorizontal: 20,
    marginTop: 20,
    gap: 12,
  },
  retakeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.cardBg,
    borderRadius: 14,
    paddingVertical: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  retakeBtnText: { color: C.textSecondary, fontSize: 15, fontWeight: "600" },
  useBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.green,
    borderRadius: 14,
    paddingVertical: 16,
    gap: 8,
  },
  useBtnDisabled: { backgroundColor: C.border },
  useBtnText: { color: C.textInverse, fontSize: 15, fontWeight: "800" },
  permBox: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
    padding: 40,
  },
  permIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: C.primaryLight,
    borderWidth: 1,
    borderColor: C.primaryMuted,
    justifyContent: "center",
    alignItems: "center",
  },
  permTitle: { color: C.textPrimary, fontSize: 20, fontWeight: "700" },
  permSub: { color: C.textSecondary, fontSize: 14, textAlign: "center", lineHeight: 20 },
  permBtn: {
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 28,
  },
  permBtnText: { color: C.textInverse, fontWeight: "800", fontSize: 15 },
});