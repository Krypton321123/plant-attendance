import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Pressable,
  Animated,
  Dimensions,
} from "react-native";
import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { STORAGE_KEYS } from "../constants/config";
import { useDrawer } from "../context/DrawerContext";
import { C } from "@/constants/theme";

const DRAWER_WIDTH = Dimensions.get("window").width * 0.76;
const DURATION = 220;

type NavItem = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  adminOnly?: boolean;
  ppSupervisorOnly?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", icon: "grid-outline", route: "/supervisor/home" },
  {
    label: "Attendance Report",
    icon: "document-text-outline",
    route: "/supervisor/report",
  },
  {
    label: "Filling Plant",
    icon: "flask-outline",
    route: "/supervisor/filling-plant",
    ppSupervisorOnly: true,
  },
  {
    label: "Dispatch Plant",
    icon: "cube-outline",
    route: "/supervisor/dispatch-plant",
  },
  {
    label: "Manage Employees",
    icon: "people-outline",
    route: "/admin/home",
    adminOnly: true,
  },
  {
    label: "Create Employee",
    icon: "person-add-outline",
    route: "/supervisor/create-employee",
    adminOnly: true,
  },
  {
    label: "Wastage Plant",
    icon: "water-outline",
    route: "/supervisor/wastage-plant",
    ppSupervisorOnly: true,
  },
];

type Props = { supervisorName?: string; empType?: string };

export default function SupervisorDrawer({ supervisorName, empType }: Props) {
  const { isOpen, close } = useDrawer();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  const translateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isOpen) {
      Animated.parallel([
        Animated.timing(translateX, {
          toValue: 0,
          duration: DURATION,
          useNativeDriver: true,
          easing: (t) => t,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: DURATION,
          useNativeDriver: true,
          easing: (t) => t,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateX, {
          toValue: -DRAWER_WIDTH,
          duration: DURATION,
          useNativeDriver: true,
          easing: (t) => t,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: DURATION,
          useNativeDriver: true,
          easing: (t) => t,
        }),
      ]).start();
    }
  }, [isOpen]);

  const handleNav = (route: string) => {
    close();
    setTimeout(() => router.push(route as any), DURATION + 20);
  };

  const handleLogout = async () => {
    close();
    await AsyncStorage.removeItem(STORAGE_KEYS.EMPLOYEE);
    setTimeout(() => router.replace("/auth/select-employee"), DURATION + 20);
  };

  const isAdmin = empType === "ADMIN";
  const isPPSupervisor = empType === "PPSUPERVISOR";

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.adminOnly && !isAdmin) return false;
    if (item.ppSupervisorOnly && !isPPSupervisor) return false;
    return true;
  });

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents={isOpen ? "box-none" : "none"}
    >
      <Animated.View
        style={[styles.backdrop, { opacity: backdropOpacity }]}
        pointerEvents={isOpen ? "auto" : "none"}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
      </Animated.View>

      <Animated.View
        style={[
          styles.drawer,
          { paddingTop: insets.top + 16 },
          { transform: [{ translateX }] },
        ]}
        pointerEvents={isOpen ? "auto" : "none"}
      >
        <View style={styles.drawerHeader}>
          <View style={styles.logoMark}>
            <Ionicons name="finger-print-outline" size={22} color={C.primary} />
          </View>
          <View>
            <Text style={styles.appName}>Plant App</Text>
            <Text style={styles.roleBadge}>
              {isAdmin
                ? "Admin"
                : isPPSupervisor
                  ? "PP Supervisor"
                  : "Supervisor"}
            </Text>
          </View>
        </View>

        {supervisorName && (
          <View style={styles.userRow}>
            <View
              style={[
                styles.avatar,
                isAdmin && styles.avatarAdmin,
                isPPSupervisor && styles.avatarPP,
              ]}
            >
              <Text
                style={[
                  styles.avatarText,
                  isAdmin && styles.avatarTextAdmin,
                  isPPSupervisor && styles.avatarTextPP,
                ]}
              >
                {supervisorName.slice(0, 2).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.userName} numberOfLines={1}>
                {supervisorName}
              </Text>
              <View
                style={[
                  styles.roleChip,
                  isAdmin && styles.roleChipAdmin,
                  isPPSupervisor && styles.roleChipPP,
                ]}
              >
                <Text
                  style={[
                    styles.roleChipText,
                    isAdmin && styles.roleChipTextAdmin,
                    isPPSupervisor && styles.roleChipTextPP,
                  ]}
                >
                  {isAdmin
                    ? "ADMIN"
                    : isPPSupervisor
                      ? "PP SUPERVISOR"
                      : "SUPERVISOR"}
                </Text>
              </View>
            </View>
          </View>
        )}

        <View style={styles.divider} />

        <View style={styles.navList}>
          {visibleItems.map((item) => {
            const active = pathname === item.route;
            return (
              <TouchableOpacity
                key={item.route}
                style={[styles.navItem, active && styles.navItemActive]}
                onPress={() => handleNav(item.route)}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.navIconWrap,
                    active && styles.navIconWrapActive,
                  ]}
                >
                  <Ionicons
                    name={item.icon}
                    size={18}
                    color={active ? C.primary : C.textMuted}
                  />
                </View>
                <Text
                  style={[styles.navLabel, active && styles.navLabelActive]}
                >
                  {item.label}
                </Text>
                {active && <View style={styles.activeIndicator} />}
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={18} color={C.textMuted} />
            <Text style={styles.logoutText}>Switch Account</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(15,23,42,0.35)",
  },
  drawer: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    width: DRAWER_WIDTH,
    backgroundColor: C.cardBg,
    borderRightWidth: 1,
    borderRightColor: C.border,
    shadowColor: "#0F172A",
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 16,
  },
  drawerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  logoMark: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.primaryLight,
    borderWidth: 1,
    borderColor: C.primaryMuted,
    justifyContent: "center",
    alignItems: "center",
  },
  appName: {
    color: C.textPrimary,
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  roleBadge: {
    color: C.textMuted,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginTop: 1,
  },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 16,
    backgroundColor: C.subtleBg,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: C.primaryMuted,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.primaryLight,
    borderWidth: 1.5,
    borderColor: C.primaryMuted,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarAdmin: { backgroundColor: "#EDE9FE", borderColor: "#C4B5FD" },
  avatarPP: { backgroundColor: "#ECFDF5", borderColor: "#6EE7B7" },
  avatarText: { color: C.primary, fontSize: 14, fontWeight: "800" },
  avatarTextAdmin: { color: "#7C3AED" },
  avatarTextPP: { color: "#059669" },
  userName: {
    color: C.textPrimary,
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 4,
  },
  roleChip: {
    alignSelf: "flex-start",
    backgroundColor: C.primaryMuted,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  roleChipAdmin: { backgroundColor: "#DDD6FE" },
  roleChipPP: { backgroundColor: "#A7F3D0" },
  roleChipText: {
    color: C.primaryDark,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  roleChipTextAdmin: { color: "#7C3AED" },
  roleChipTextPP: { color: "#065F46" },
  divider: {
    height: 1,
    backgroundColor: C.border,
    marginHorizontal: 16,
    marginVertical: 16,
  },
  navList: { flex: 1, paddingHorizontal: 12 },
  navItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: 12,
    marginBottom: 2,
  },
  navItemActive: { backgroundColor: C.primaryLight },
  navIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: C.inputBg,
    justifyContent: "center",
    alignItems: "center",
  },
  navIconWrapActive: { backgroundColor: C.primaryMuted },
  navLabel: {
    color: C.textSecondary,
    fontSize: 14,
    fontWeight: "600",
    flex: 1,
  },
  navLabelActive: { color: C.primary, fontWeight: "700" },
  activeIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.primary,
  },
  footer: {
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 12,
  },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
  },
  logoutText: { color: C.textMuted, fontSize: 14, fontWeight: "600" },
});
