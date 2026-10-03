import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { STORAGE_KEYS } from "../../constants/config";
import { C } from "../../constants/theme";
import { isRealAdmin, routeForEmpType } from "../../util/roles";

type RoleOption = {
  value: string;
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
};

// Every EMPTYPE the app has a landing screen for (see routeForEmpType).
const ROLE_OPTIONS: RoleOption[] = [
  {
    value: "ADMIN",
    label: "Admin",
    description: "Manage and create employees",
    icon: "settings-outline",
  },
  {
    value: "SUPERVISOR",
    label: "Supervisor",
    description: "Attendance, reports and dispatch",
    icon: "people-outline",
  },
  {
    value: "PPSUPERVISOR",
    label: "PP supervisor",
    description: "Supervisor plus filling and wastage plants",
    icon: "flask-outline",
  },
  {
    value: "KPSUPERVISOR",
    label: "KP supervisor",
    description: "Attendance, reports and dispatch",
    icon: "business-outline",
  },
  {
    value: "OFFICE",
    label: "Office",
    description: "Create and finalize dispatch sessions",
    icon: "briefcase-outline",
  },
  {
    value: "GUARD",
    label: "Guard",
    description: "Self attendance and the gate entry log",
    icon: "shield-checkmark-outline",
  },
  {
    value: "INDIVIDUAL",
    label: "Individual",
    description: "Self attendance only",
    icon: "person-outline",
  },
];

export default function SelectRoleScreen() {
  const router = useRouter();
  const [employee, setEmployee] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [pendingRole, setPendingRole] = useState<string | null>(null);

  useEffect(() => {
    loadSession();
  }, []);

  // Only real admins belong here. Anyone else (or nobody) goes back to the
  // PIN screen, which sends them wherever they should be.
  const loadSession = async () => {
    let emp: any = null;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.EMPLOYEE);
      emp = raw ? JSON.parse(raw) : null;
    } catch {
      // an unreadable session is treated the same as no session
    }

    if (!isRealAdmin(emp)) {
      router.replace("/");
      return;
    }
    setEmployee(emp);
    setLoading(false);
  };

  const pickRole = async (role: string) => {
    if (!employee || pendingRole) return;
    setPendingRole(role);
    try {
      // Only the cached session changes — the employee's row in the database
      // is still ADMIN. Every screen reads EMPTYPE from this cache, so they
      // all behave as the chosen role from here on.
      await AsyncStorage.setItem(
        STORAGE_KEYS.EMPLOYEE,
        JSON.stringify({ ...employee, EMPTYPE: role })
      );
      router.replace(routeForEmpType(role));
    } catch {
      setPendingRole(null);
    }
  };

  const switchAccount = async () => {
    await AsyncStorage.removeItem(STORAGE_KEYS.EMPLOYEE);
    router.replace("/");
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.iconWrap}>
          <Ionicons name="swap-horizontal" size={28} color={C.primary} />
        </View>
        <Text style={styles.title}>Log in as</Text>
        <Text style={styles.sub}>
          You're signed in as {employee?.EMPNAME}. Choose which role to use the
          app as.
        </Text>

        {ROLE_OPTIONS.map((opt) => {
          const active = employee?.EMPTYPE === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[styles.card, active && styles.cardActive]}
              onPress={() => pickRole(opt.value)}
              disabled={pendingRole !== null}
              activeOpacity={0.7}
            >
              <View style={[styles.cardIcon, active && styles.cardIconActive]}>
                <Ionicons
                  name={opt.icon}
                  size={20}
                  color={active ? C.primary : C.textMuted}
                />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={styles.cardLabel}>{opt.label}</Text>
                <Text style={styles.cardDesc}>{opt.description}</Text>
              </View>

              {pendingRole === opt.value ? (
                <ActivityIndicator size="small" color={C.primary} />
              ) : active ? (
                <View style={styles.currentChip}>
                  <Text style={styles.currentChipText}>Current</Text>
                </View>
              ) : (
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={C.textMuted}
                />
              )}
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity style={styles.switchAccount} onPress={switchAccount}>
          <Text style={styles.switchAccountText}>
            Not you? <Text style={styles.switchAccountBold}>Switch account</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
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
  content: {
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 16,
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
    alignSelf: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: C.textPrimary,
    letterSpacing: -0.4,
    textAlign: "center",
    marginBottom: 6,
  },
  sub: {
    fontSize: 15,
    color: C.textSecondary,
    textAlign: "center",
    lineHeight: 21,
    marginBottom: 28,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.cardBg,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: C.border,
    padding: 14,
    marginBottom: 10,
  },
  cardActive: {
    borderColor: C.primary,
    backgroundColor: C.primaryLight,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 11,
    backgroundColor: C.inputBg,
    justifyContent: "center",
    alignItems: "center",
  },
  cardIconActive: { backgroundColor: C.primaryMuted },
  cardLabel: {
    color: C.textPrimary,
    fontSize: 15,
    fontWeight: "700",
  },
  cardDesc: {
    color: C.textMuted,
    fontSize: 12.5,
    marginTop: 2,
  },
  currentChip: {
    backgroundColor: C.primaryMuted,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  currentChipText: {
    color: C.primaryDark,
    fontSize: 11,
    fontWeight: "700",
  },
  switchAccount: {
    alignItems: "center",
    paddingVertical: 20,
  },
  switchAccountText: {
    color: C.textMuted,
    fontSize: 14,
  },
  switchAccountBold: {
    color: C.primary,
    fontWeight: "700",
  },
});