import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  SafeAreaView,
  TextInput,
} from "react-native";
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { API_URL, STORAGE_KEYS } from "../../constants/config";
import { getOrCreateDeviceId } from "../../util/deviceid";

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

    // If this employee already has a device registered with same deviceId → they registered before
    if (selected.DEVICEID === deviceId) {
      // Just restore session and navigate
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

    // New device or new employee → go to photo registration
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
          <View style={styles.typeBadge}>
            <Text style={styles.typeText}>{item.EMPTYPE}</Text>
          </View>
        </View>
        {isSelected && (
          <Ionicons name="checkmark-circle" size={24} color="#E8A020" />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Ionicons name="business" size={24} color="#E8A020" />
        </View>
        <Text style={styles.headerTitle}>Plant Attendance</Text>
        <Text style={styles.headerSub}>Who are you? Select your name below.</Text>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={18} color="#888" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or role..."
          placeholderTextColor="#555"
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* List */}
      {loading ? (
        <ActivityIndicator size="large" color="#E8A020" style={{ marginTop: 40 }} />
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
              <ActivityIndicator color="#0D0D0D" />
            ) : (
              <>
                <Text style={styles.continueBtnText}>Continue</Text>
                <Ionicons name="arrow-forward" size={20} color="#0D0D0D" />
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
    backgroundColor: "#0D0D0D",
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 24,
  },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: "#1A1A1A",
    borderWidth: 1,
    borderColor: "#2A2A2A",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  headerSub: {
    fontSize: 15,
    color: "#666",
    fontWeight: "400",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1A1A1A",
    marginHorizontal: 24,
    marginBottom: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2A2A2A",
    paddingHorizontal: 14,
    height: 46,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    color: "#FFF",
    fontSize: 15,
  },
  list: {
    paddingHorizontal: 24,
    paddingBottom: 120,
    gap: 10,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#141414",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: "#222",
    gap: 12,
  },
  cardSelected: {
    borderColor: "#E8A020",
    backgroundColor: "#1C1505",
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#222",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarSelected: {
    backgroundColor: "#E8A020",
  },
  avatarText: {
    color: "#888",
    fontSize: 16,
    fontWeight: "700",
  },
  avatarTextSelected: {
    color: "#0D0D0D",
  },
  cardInfo: { flex: 1 },
  empName: {
    color: "#DDD",
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 2,
  },
  empNameSelected: { color: "#FFF" },
  empDesg: {
    color: "#555",
    fontSize: 13,
    marginBottom: 6,
  },
  empDesgSelected: { color: "#999" },
  typeBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#1E1E1E",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: "#333",
  },
  typeText: {
    color: "#666",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
  },
  emptyText: {
    color: "#444",
    textAlign: "center",
    marginTop: 40,
    fontSize: 15,
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#0D0D0D",
    borderTopWidth: 1,
    borderTopColor: "#1E1E1E",
    padding: 20,
    paddingBottom: 36,
    gap: 12,
  },
  selectedLabel: {
    color: "#666",
    fontSize: 13,
    textAlign: "center",
  },
  continueBtn: {
    backgroundColor: "#E8A020",
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  continueBtnText: {
    color: "#0D0D0D",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
});