// Safe BLE wrapper — only activates on a native dev/prod build.
// On web + Expo Go it exposes a stub that reports "not supported".

import Constants from "expo-constants";
import { PermissionsAndroid, Platform } from "react-native";

export type ScannedDevice = {
  id: string;
  name: string | null;
  rssi: number | null;
};

export type ConnectedInfo = {
  id: string;
  name: string | null;
  services: string[];
};

type Unsub = () => void;

type BleAPI = {
  supported: boolean;
  reason?: string;
  ensurePermissions: () => Promise<boolean>;
  scan: (onDevice: (d: ScannedDevice) => void, onError?: (e: string) => void) => Unsub;
  connect: (deviceId: string) => Promise<ConnectedInfo>;
  disconnect: (deviceId: string) => Promise<void>;
};

const isExpoGo = Constants.executionEnvironment === "storeClient";
const isWeb = Platform.OS === "web";

async function ensureAndroidPermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  try {
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
    connect: async () => {
      throw new Error(reason);
    },
    disconnect: async () => {},
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
    async connect(deviceId) {
      const m = getManager();
      // Stop scanning before attempting connect (Android requirement).
      try { m.stopDeviceScan(); } catch {}
      const dev = await m.connectToDevice(deviceId, { timeout: 15000 });
      await dev.discoverAllServicesAndCharacteristics();
      let services: any[] = [];
      try {
        services = await dev.services();
      } catch {
        services = [];
      }
      return {
        id: dev.id,
        name: dev.name ?? dev.localName ?? null,
        services: services.map((s: any) => s.uuid),
      };
    },
    async disconnect(deviceId) {
      const m = getManager();
      try {
        await m.cancelDeviceConnection(deviceId);
      } catch {
        // ignore
      }
    },
  };
}

export const ble: BleAPI = isWeb
  ? makeStub("Real BLE only runs on a native Android/iOS build. Not available on web preview.")
  : isExpoGo
  ? makeStub("Real BLE cannot run in Expo Go. Publish and generate a native build to test.")
  : makeReal();
