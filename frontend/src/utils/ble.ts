// Safe BLE wrapper — only activates on a native dev/prod build.
// On web + Expo Go it exposes a stub that reports "not supported".
//
// Usage:
//   import { ble } from "@/src/utils/ble";
//   if (ble.supported) { ... }
//   const stop = ble.scan(onDeviceFound); // returns stop() to cancel scan

import Constants from "expo-constants";
import { PermissionsAndroid, Platform } from "react-native";

export type ScannedDevice = {
  id: string;
  name: string | null;
  rssi: number | null;
};

type Unsub = () => void;

type BleAPI = {
  supported: boolean;
  reason?: string;
  ensurePermissions: () => Promise<boolean>;
  scan: (onDevice: (d: ScannedDevice) => void, onError?: (e: string) => void) => Unsub;
};

const isExpoGo = Constants.executionEnvironment === "storeClient";
const isWeb = Platform.OS === "web";

async function ensureAndroidPermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  try {
    // Android 12+ (API 31+) needs BLUETOOTH_SCAN & BLUETOOTH_CONNECT.
    // Older Android needs ACCESS_FINE_LOCATION for scanning.
    const wanted = [
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ].filter(Boolean) as string[];
    const res = await PermissionsAndroid.requestMultiple(wanted as never);
    return wanted.every((p) => res[p as keyof typeof res] === PermissionsAndroid.RESULTS.GRANTED);
  } catch {
    return false;
  }
}

function makeStub(reason: string): BleAPI {
  return {
    supported: false,
    reason,
    ensurePermissions: async () => false,
    scan: () => () => {},
  };
}

function makeReal(): BleAPI {
  let BleManagerCtor: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    BleManagerCtor = require("react-native-ble-plx").BleManager;
  } catch (e: any) {
    return makeStub(`BLE module unavailable: ${e?.message ?? "unknown"}`);
  }

  let manager: any = null;
  const getManager = () => {
    if (!manager) manager = new BleManagerCtor();
    return manager;
  };

  return {
    supported: true,
    ensurePermissions: ensureAndroidPermissions,
    scan(onDevice, onError) {
      const m = getManager();
      const seen = new Set<string>();
      try {
        m.startDeviceScan(null, null, (err: any, device: any) => {
          if (err) {
            onError?.(err?.message ?? String(err));
            return;
          }
          if (!device || seen.has(device.id)) return;
          seen.add(device.id);
          onDevice({
            id: device.id,
            name: device.name ?? device.localName ?? null,
            rssi: typeof device.rssi === "number" ? device.rssi : null,
          });
        });
      } catch (e: any) {
        onError?.(e?.message ?? "Scan failed");
      }
      return () => {
        try {
          m.stopDeviceScan();
        } catch {
          // ignore
        }
      };
    },
  };
}

export const ble: BleAPI = isWeb
  ? makeStub("Real BLE only runs on a native Android/iOS build. Not available on web preview.")
  : isExpoGo
  ? makeStub("Real BLE cannot run in Expo Go. Publish and generate a native build to test.")
  : makeReal();
