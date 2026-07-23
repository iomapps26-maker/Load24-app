import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const DEVICE_ID_KEY = 'load24_device_id';

function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// Stable per-install device identity, used to tell devices apart for the
// login check-in / suspicious-login and logout-all-devices features.
// Not a hardware ID — reinstalling the app issues a new one.
export async function getDeviceId() {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;

  const id = generateId();
  await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

export function getDeviceInfo() {
  return {
    platform: Platform.OS,
    os_version: String(Platform.Version)
  };
}
