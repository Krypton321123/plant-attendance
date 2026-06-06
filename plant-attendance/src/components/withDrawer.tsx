import { ReactNode, useEffect, useState } from "react";
import { View, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import SupervisorDrawer from "./SupervisorDrawer";
import { useDrawer } from "../context/DrawerContext";
import { STORAGE_KEYS } from "../constants/config";
import { C } from "../constants/theme";

type Props = { children: ReactNode };

export default function WithDrawer({ children }: Props) {
  const { open } = useDrawer();
  const [name, setName]       = useState("");
  const [empType, setEmpType] = useState("");

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEYS.EMPLOYEE).then(raw => {
      if (raw) {
        const emp = JSON.parse(raw);
        setName(emp.EMPNAME ?? "");
        setEmpType(emp.EMPTYPE ?? "");
      }
    });
  }, []);

  return (
    <View style={styles.root}>
      {children}
      <SupervisorDrawer supervisorName={name} empType={empType} />
    </View>
  );
}

export function MenuButton() {
  const { open } = useDrawer();
  return (
    <TouchableOpacity style={styles.menuBtn} onPress={open} activeOpacity={0.7}>
      <Ionicons name="menu-outline" size={22} color={C.textPrimary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1 },
  menuBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: C.cardBg,
    justifyContent: "center", alignItems: "center",
    borderWidth: 1, borderColor: C.border,
    shadowColor: "#0F172A", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
});