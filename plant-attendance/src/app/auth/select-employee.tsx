import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  TextInput,
} from "react-native";
import { useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { API_URL, STORAGE_KEYS } from "../../constants/config";
import { getOrCreateDeviceId } from "../../util/deviceid";
import { C } from "../../constants/theme";

type Employee = {
  EMP_ID: string;
  EMPNAME: string;
  EMPFNAME: string;
  EMPDESG: string;
  EMPTYPE: string;
  STATUS: string;
  DEVICEID: string | null;
};

export default function SelectEmployeeScreen() {
  const router = useRouter();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [filtered, setFiltered] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Employee | null>(null);
  const [continuing, setContinuing] = useState(false);

  useEffect(() => {
    fetchEmployees();
  }, []);

  useEffect(() => {
    const q = search.toLowerCase();
    setFiltered(
      employees.filter(
        (e) =>
          e.EMPNAME.toLowerCase().includes(q) ||
          e.EMPFNAME.toLowerCase().includes(q) ||
          e.EMPDESG.toLowerCase().includes(q)
      )
    );
  }, [search, employees]);

  const fetchEmployees = async () => {
    try {
      const res = await fetch(`${API_URL}/employees`);
      const data = await res.json();
      if (data.success) {
        setEmployees(data.data);
        setFiltered(data.data);
      }
    } catch {
      // handle error
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = async () => {
    if (!selected) return;
    setContinuing(true);

    const deviceId = await getOrCreateDeviceId();

    if (selected.DEVICEID === deviceId) {
      await AsyncStorage.setItem(
        STORAGE_KEYS.EMPLOYEE,
        JSON.stringify({ ...selected, DEVICEID: deviceId })
      );
      if (selected.STATUS === "A") {
        router.replace(
          selected.EMPTYPE === "SUPERVISOR" ? "/supervisor/home" : "/individual/home"
        );
      } else {
        router.replace("/auth/pending");
      }
      setContinuing(false);
      return;
    }

    await AsyncStorage.setItem(
      STORAGE_KEYS.EMPLOYEE,
      JSON.stringify({ ...selected, DEVICEID: deviceId })
    );
    router.push("/auth/register-photo");
    setContinuing(false);
  };

  const renderEmployee = ({ item }: { item: Employee }) => {
    const isSelected = selected?.EMP_ID === item.EMP_ID;
    const initials = `${item.EMPNAME[0]}${item.EMPFNAME[0]}`.toUpperCase();

    return (
      <TouchableOpacity
        style={[styles.card, isSelected && styles.cardSelected]}
        onPress={() => setSelected(item)}
        activeOpacity={0.7}
      >
        <View style={[styles.avatar, isSelected && styles.avatarSelected]}>
          <Text style={[styles.avatarText, isSelected && styles.avatarTextSelected]}>
            {initials}
          </Text>
        </View>
        <View style={styles.cardInfo}>
          <Text style={[styles.empName, isSelected && styles.empNameSelected]}>
            {item.EMPNAME} {item.EMPFNAME}
          </Text>
          <Text style={[styles.empDesg, isSelected && styles.empDesgSelected]}>
            {item.EMPDESG}
          </Text>
          <View style={[styles.typeBadge, isSelected && styles.typeBadgeSelected]}>
            <Text style={[styles.typeText, isSelected && styles.typeTextSelected]}>
              {item.EMPTYPE}
            </Text>
          </View>
        </View>
        {isSelected && (
          <Ionicons name="checkmark-circle" size={24} color={C.primary} />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.headerIcon}>
            <Ionicons name="business" size={22} color={C.primary} />
          </View>
          <TouchableOpacity
            style={styles.adminLink}
            onPress={() => router.push("/auth/admin-login")}
            activeOpacity={0.7}
          >
            <Ionicons name="shield-checkmark-outline" size={14} color={C.textMuted} />
            <Text style={styles.adminLinkText}>Admin</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.headerTitle}>Plant Attendance</Text>
        <Text style={styles.headerSub}>Who are you? Select your name below.</Text>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={18} color={C.textMuted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or role..."
          placeholderTextColor={C.textMuted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* List */}
      {loading ? (
        <ActivityIndicator size="large" color={C.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.EMP_ID}
          renderItem={renderEmployee}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No employees found</Text>
          }
        />
      )}

      {/* Continue Button */}
      {selected && (
        <View style={styles.footer}>
          <Text style={styles.selectedLabel}>
            Selected: {selected.EMPNAME} {selected.EMPFNAME}
          </Text>
          <TouchableOpacity
            style={styles.continueBtn}
            onPress={handleContinue}
            disabled={continuing}
          >
            {continuing ? (
              <ActivityIndicator color={C.textInverse} />
            ) : (
              <>
                <Text style={styles.continueBtnText}>Continue</Text>
                <Ionicons name="arrow-forward" size={20} color={C.textInverse} />
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.pageBg,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 24,
    backgroundColor: C.cardBg,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: C.primaryLight,
    borderWidth: 1,
    borderColor: C.primaryMuted,
    justifyContent: "center",
    alignItems: "center",
  },
  adminLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: C.inputBg,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  adminLinkText: {
    color: C.textMuted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: C.textPrimary,
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  headerSub: {
    fontSize: 15,
    color: C.textSecondary,
    fontWeight: "400",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.cardBg,
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    height: 46,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 3,
    elevation: 1,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    color: C.textPrimary,
    fontSize: 15,
  },
  list: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 120,
    gap: 8,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.cardBg,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: C.border,
    gap: 12,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 3,
    elevation: 1,
  },
  cardSelected: {
    borderColor: C.primary,
    backgroundColor: C.primaryLight,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: C.inputBg,
    borderWidth: 1,
    borderColor: C.border,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarSelected: {
    backgroundColor: C.primary,
    borderColor: C.primaryDark,
  },
  avatarText: {
    color: C.textSecondary,
    fontSize: 16,
    fontWeight: "700",
  },
  avatarTextSelected: {
    color: C.textInverse,
  },
  cardInfo: { flex: 1 },
  empName: {
    color: C.textPrimary,
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 2,
  },
  empNameSelected: { color: C.primaryDark },
  empDesg: {
    color: C.textMuted,
    fontSize: 13,
    marginBottom: 6,
  },
  empDesgSelected: { color: C.textSecondary },
  typeBadge: {
    alignSelf: "flex-start",
    backgroundColor: C.inputBg,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: C.border,
  },
  typeBadgeSelected: {
    backgroundColor: C.primaryMuted,
    borderColor: C.primary,
  },
  typeText: {
    color: C.textMuted,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
  },
  typeTextSelected: {
    color: C.primary,
  },
  emptyText: {
    color: C.textMuted,
    textAlign: "center",
    marginTop: 40,
    fontSize: 15,
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: C.cardBg,
    borderTopWidth: 1,
    borderTopColor: C.border,
    padding: 20,
    paddingBottom: 36,
    gap: 12,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 8,
  },
  selectedLabel: {
    color: C.textSecondary,
    fontSize: 13,
    textAlign: "center",
  },
  continueBtn: {
    backgroundColor: C.primary,
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  continueBtnText: {
    color: C.textInverse,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
});