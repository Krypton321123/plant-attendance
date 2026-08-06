import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import { STORAGE_KEYS } from "../constants/config";

export const getOrCreateDeviceId = async (): Promise<string> => {
  const existing = await AsyncStorage.getItem(STORAGE_KEYS.DEVICE_ID);
  if (existing) return existing;

  let newId: string;

  if (Platform.OS === "android") {
    newId = Application.getAndroidId() ?? Crypto.randomUUID();
  } else {
    newId = Crypto.randomUUID();
  }

  await AsyncStorage.setItem(STORAGE_KEYS.DEVICE_ID, newId);
  return newId;
};