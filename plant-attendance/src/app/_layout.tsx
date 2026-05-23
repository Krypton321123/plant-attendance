import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="auth/select-employee" />
        <Stack.Screen name="auth/register-photo" />
        <Stack.Screen name="auth/pending" />
        <Stack.Screen name="supervisor/home" />
        <Stack.Screen name="individual/home" />
        <Stack.Screen name="camera/mark" />
      </Stack>
    </>
  );
}