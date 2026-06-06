import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { DrawerProvider } from "../context/DrawerContext";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <DrawerProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="auth/select-employee" />
          <Stack.Screen name="auth/admin-login" />
          <Stack.Screen name="auth/register-photo" />
          <Stack.Screen name="auth/pending" />
          <Stack.Screen name="supervisor/home" />
          <Stack.Screen name="supervisor/report" />
          <Stack.Screen name="supervisor/create-employee" />
          <Stack.Screen name="supervisor/filling-plant" />
          <Stack.Screen name="supervisor/wastage-plant" />
          <Stack.Screen name="admin/home" />
          <Stack.Screen name="individual/home" />
          <Stack.Screen name="camera/mark" />
        </Stack>
      </DrawerProvider>
    </SafeAreaProvider>
  );
}