import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { STORAGE_KEYS } from "../constants/config";

export const getOrCreateDeviceId = async (): Promise<string> => {
  const existing = await AsyncStorage.getItem(STORAGE_KEYS.DEVICE_ID);
  if (existing) return existing;

  const newId = Crypto.randomUUID();
  await AsyncStorage.setItem(STORAGE_KEYS.DEVICE_ID, newId);
  return newId;
};