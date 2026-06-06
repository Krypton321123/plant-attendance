import { Platform, StatusBar } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Returns consistent top/bottom padding that accounts for:
 * - iOS notch / dynamic island (via safe-area-insets)
 * - Android status bar (StatusBar.currentHeight)
 *
 * Usage:
 *   const { topPad, bottomPad } = useSafeArea();
 *   <View style={{ paddingTop: topPad }}>
 */
export function useSafeArea() {
  const insets = useSafeAreaInsets();

  const topPad =
    Platform.OS === "android"
      ? (StatusBar.currentHeight ?? 24)
      : insets.top;

  const bottomPad = insets.bottom;

  return { topPad, bottomPad, insets };
}