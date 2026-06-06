import {
  View, Text, TouchableOpacity, StyleSheet, 
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform,
} from "react-native";
import { useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { API_URL, STORAGE_KEYS } from "../../constants/config";
import { C } from "../../constants/theme";

export default function AdminLoginScreen() {
  const router = useRouter();
  const [adminId,      setAdminId]      = useState("");
  const [password,     setPassword]     = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState("");

  const handleLogin = async () => {
    if (!adminId.trim() || !password.trim()) { setError("Both fields are required"); return; }
    setLoading(true); setError("");
    try {
      const res  = await fetch(`${API_URL}/employees/admin-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminId: adminId.trim(), password }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Invalid credentials"); setLoading(false); return; }
      await AsyncStorage.setItem(STORAGE_KEYS.EMPLOYEE, JSON.stringify({
        EMP_ID: "ADMIN", EMPNAME: "Admin", EMPFNAME: "", EMPTYPE: "ADMIN", STATUS: "A",
      }));
      router.replace("/admin/home");
    } catch {
      setError("Connection error. Please try again.");
    } finally { setLoading(false); }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.inner}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color={C.textSecondary} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <View style={styles.header}>
          <View style={styles.iconWrap}>
            <Ionicons name="shield-checkmark" size={28} color={C.primary} />
          </View>
          <Text style={styles.title}>Admin Access</Text>
          <Text style={styles.subtitle}>Restricted area. Enter your admin credentials to continue.</Text>
        </View>

        <View style={styles.card}>
          {/* Admin ID */}
          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Admin ID</Text>
            <View style={[styles.inputRow, error && !adminId && styles.inputError]}>
              <Ionicons name="person-outline" size={16} color={C.textMuted} />
              <TextInput
                style={styles.input}
                placeholder="Enter admin ID"
                placeholderTextColor={C.textMuted}
                value={adminId}
                onChangeText={t => { setAdminId(t); setError(""); }}
                autoCapitalize="none" autoCorrect={false}
              />
            </View>
          </View>

          {/* Password */}
          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Password</Text>
            <View style={[styles.inputRow, error && !password && styles.inputError]}>
              <Ionicons name="lock-closed-outline" size={16} color={C.textMuted} />
              <TextInput
                style={styles.input}
                placeholder="Enter password"
                placeholderTextColor={C.textMuted}
                value={password}
                onChangeText={t => { setPassword(t); setError(""); }}
                secureTextEntry={!showPassword}
                autoCapitalize="none" autoCorrect={false}
              />
              <TouchableOpacity onPress={() => setShowPassword(v => !v)} style={{ padding: 4 }}>
                <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={18} color={C.textMuted} />
              </TouchableOpacity>
            </View>
          </View>

          {error ? (
            <View style={styles.errorWrap}>
              <Ionicons name="alert-circle-outline" size={15} color={C.red} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
            onPress={handleLogin} disabled={loading} activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color={C.textInverse} />
              : <><Text style={styles.loginBtnText}>Login as Admin</Text><Ionicons name="arrow-forward" size={18} color={C.textInverse} /></>
            }
          </TouchableOpacity>
        </View>

        <Text style={styles.footerNote}>Admin access is logged and monitored.</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: C.pageBg },
  inner:            { flex: 1, paddingHorizontal: 24, paddingTop: 16 },
  backBtn:          { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 32 },
  backText:         { color: C.textSecondary, fontSize: 15 },
  header:           { marginBottom: 24 },
  iconWrap: {
    width: 56, height: 56, borderRadius: 18,
    backgroundColor: C.primaryLight, borderWidth: 1, borderColor: C.primaryMuted,
    justifyContent: "center", alignItems: "center", marginBottom: 20,
  },
  title:    { fontSize: 30, fontWeight: "800", color: C.textPrimary, letterSpacing: -0.5, marginBottom: 8 },
  subtitle: { fontSize: 14, color: C.textSecondary, lineHeight: 20 },
  card: {
    backgroundColor: C.cardBg, borderRadius: 20, padding: 20, gap: 16,
    borderWidth: 1, borderColor: C.border,
    shadowColor: "#0F172A", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  fieldWrap:      { gap: 8 },
  label:          { color: C.textSecondary, fontSize: 12, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" },
  inputRow: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: C.inputBg, borderRadius: 12,
    borderWidth: 1.5, borderColor: C.border, paddingHorizontal: 14, height: 52, gap: 10,
  },
  inputError:     { borderColor: C.red },
  input:          { flex: 1, color: C.textPrimary, fontSize: 15 },
  errorWrap: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: C.redBg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: C.redLight,
  },
  errorText:      { color: C.red, fontSize: 13, flex: 1 },
  loginBtn: {
    backgroundColor: C.primary, borderRadius: 14, paddingVertical: 16,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 4,
  },
  loginBtnDisabled: { opacity: 0.6 },
  loginBtnText:   { color: C.textInverse, fontSize: 16, fontWeight: "800", letterSpacing: 0.3 },
  footerNote:     { color: C.textMuted, fontSize: 12, textAlign: "center", marginTop: "auto", paddingBottom: 24, paddingTop: 32 },
});