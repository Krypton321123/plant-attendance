import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { API_URL, STORAGE_KEYS } from "../constants/config";
import { getOrCreateDeviceId } from "../util/deviceid";
import { C } from "../constants/theme";

const PIN_LENGTH = 6;

export default function IndexScreen() {
  const router = useRouter();
  const [checkingSession, setCheckingSession] = useState(true);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<TextInput | null>(null);

  useEffect(() => {
    checkSession();
  }, []);

  const routeForEmpType = (empType: string) => {
    switch (empType) {
      case "ADMIN":
        return "/admin/home";
      case "SUPERVISOR":
      case "PPSUPERVISOR":
      case "KPSUPERVISOR":
      case "OFFICE":
        return "/supervisor/home";
      default:
        return "/individual/home";
    }
  };

  // If a session is already stored locally, skip straight to the right
  // screen. We don't need a network round-trip here — MPIN login already
  // verified device + status when the session was first created; re-checking
  // on every app open would just add latency for no real security gain,
  // since a stolen/cloned device already has the AsyncStorage blob either way.
  const checkSession = async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.EMPLOYEE);
      if (raw) {
        const employee = JSON.parse(raw);
        if (employee?.EMPTYPE && employee?.STATUS === "A") {
          router.replace(routeForEmpType(employee.EMPTYPE));
          return;
        }
      }
    } catch {
      // fall through to PIN entry
    } finally {
      setCheckingSession(false);
    }
  };

  const handlePinChange = (text: string) => {
    const digitsOnly = text.replace(/[^0-9]/g, "").slice(0, PIN_LENGTH);
    setPin(digitsOnly);
    if (error) setError(null);
    if (digitsOnly.length === PIN_LENGTH) {
      submitPin(digitsOnly);
    }
  };

  const submitPin = async (fullPin: string) => {
    setSubmitting(true);
    setError(null);
    try {
      const deviceId = await getOrCreateDeviceId();
      const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mpin: fullPin, deviceId }),
      });
      const data = await res.json();

      if (!data.success) {
        setError(data.message || "Login failed");
        setPin("");
        return;
      }

      await AsyncStorage.setItem(STORAGE_KEYS.EMPLOYEE, JSON.stringify(data.data));
      router.replace(routeForEmpType(data.data.EMPTYPE));
    } catch {
      setError("Network error. Try again.");
      setPin("");
    } finally {
      setSubmitting(false);
    }
  };

  if (checkingSession) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.content}>
          <View style={styles.iconWrap}>
            <Ionicons name="business" size={30} color={C.primary} />
          </View>
          <Text style={styles.title}>Plant Attendance</Text>
          <Text style={styles.sub}>Enter your 6-digit PIN</Text>

          <TouchableOpacity
            activeOpacity={1}
            style={styles.pinBoxRow}
            onPress={() => inputRef.current?.focus()}
          >
            {Array.from({ length: PIN_LENGTH }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.pinBox,
                  pin.length === i && styles.pinBoxActive,
                  error && styles.pinBoxError,
                ]}
              >
                <Text style={styles.pinDigit}>{pin[i] ? "•" : ""}</Text>
              </View>
            ))}
          </TouchableOpacity>

          <TextInput
            ref={inputRef}
            value={pin}
            onChangeText={handlePinChange}
            keyboardType="number-pad"
            maxLength={PIN_LENGTH}
            style={styles.hiddenInput}
            autoFocus
            editable={!submitting}
          />

          {submitting && (
            <ActivityIndicator color={C.primary} style={{ marginTop: 20 }} />
          )}

          {error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={"#DC2626"} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={styles.signupLink}
          onPress={() => router.push("/auth/signup")}
        >
          <Text style={styles.signupLinkText}>
            Don't have a PIN? <Text style={styles.signupLinkBold}>Sign up</Text>
          </Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: C.pageBg,
    justifyContent: "center",
    alignItems: "center",
  },
  container: { flex: 1, backgroundColor: C.pageBg },
  flex: { flex: 1, justifyContent: "space-between" },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: C.primaryLight,
    borderWidth: 1,
    borderColor: C.primaryMuted,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: C.textPrimary,
    letterSpacing: -0.4,
    marginBottom: 6,
  },
  sub: {
    fontSize: 15,
    color: C.textSecondary,
    marginBottom: 36,
  },
  pinBoxRow: {
    flexDirection: "row",
    gap: 10,
  },
  pinBox: {
    width: 44,
    height: 54,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: C.cardBg,
    justifyContent: "center",
    alignItems: "center",
  },
  pinBoxActive: {
    borderColor: C.primary,
  },
  pinBoxError: {
    borderColor: "#DC2626",
  },
  pinDigit: {
    fontSize: 22,
    fontWeight: "700",
    color: C.textPrimary,
  },
  hiddenInput: {
    position: "absolute",
    opacity: 0,
    height: 1,
    width: 1,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#FEF2F2",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  errorText: {
    color: "#DC2626",
    fontSize: 13,
    fontWeight: "500",
  },
  signupLink: {
    alignItems: "center",
    paddingVertical: 24,
  },
  signupLinkText: {
    color: C.textMuted,
    fontSize: 14,
  },
  signupLinkBold: {
    color: C.primary,
    fontWeight: "700",
  },
});