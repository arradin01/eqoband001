// Safe BLE wrapper — only activates on a native dev/prod build.
// EQOband custom Service + Characteristics (must match ESP32-C3 firmware):
//   Service UUID:         6e400001-b5a3-f393-e0a9-e50e24dcca9e
//   HR Notify Char:       6e400002-b5a3-f393-e0a9-e50e24dcca9e  (uint8 BPM)
//   Battery Read Char:    6e400003-b5a3-f393-e0a9-e50e24dcca9e  (uint8 percent)
//   Gesture Notify Char:  6e400004-b5a3-f393-e0a9-e50e24dcca9e  (uint8: 1=SINGLE_TAP, 2=DOUBLE_TAP, 3=LONG_PRESS)

import Constants from "expo-constants";
import { Buffer } from "buffer";
import { PermissionsAndroid, Platform } from "react-native";

export const EQOBAND_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
export const EQOBAND_HR_CHAR_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
export const EQOBAND_BAT_CHAR_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
export const EQOBAND_GESTURE_CHAR_UUID = "6e400004-b5a3-f393-e0a9-e50e24dcca9e";

export type GestureCode = 1 | 2 | 3;
export type GestureName = "SINGLE_TAP" | "DOUBLE_TAP" | "LONG_PRESS";

export const GESTURE_MAP: Record<number, GestureName> = {
  1: "SINGLE_TAP",
  2: "DOUBLE_TAP",
  3: "LONG_PRESS",
};

export type ScannedDevice = { id: string; name: string | null; rssi: number | null };
export type ConnectedInfo = { id: string; name: string | null; services: string[]; hasEqoService: boolean };
export type HRStreamUnsub = () => void;
export type GestureStreamUnsub = () => void;

type Unsub = () => void;

type BleAPI = {
  supported: boolean;
  reason?: string;
  ensurePermissions: () => Promise<boolean>;
  scan: (onDevice: (d: ScannedDevice) => void, onError?: (e: string) => void) => Unsub;
  connect: (deviceId: string) => Promise<ConnectedInfo>;
  disconnect: (deviceId: string) => Promise<void>;
  streamHR: (
    deviceId: string,
    onBpm: (bpm: number) => void,
    onError?: (e: string) => void,
  ) => Promise<HRStreamUnsub>;
  streamGestures: (
    deviceId: string,
    onGesture: (gesture: GestureCode) => void,
    onError?: (e: string) => void,
  ) => Promise<GestureStreamUnsub>;
  readBattery: (deviceId: string) => Promise<number | null>;
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
    connect: async () => { throw new Error(reason); },
    disconnect: async () => {},
    streamHR: async () => () => {},
    streamGestures: async () => () => {},
    readBattery: async () => null,
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

  const b64ToBytes = (b64: string): Uint8Array => {
    try { return Uint8Array.from(Buffer.from(b64, "base64")); } catch { return new Uint8Array(); }
  };

  return {
    supported: true,
    ensurePermissions: ensureAndroidPermissions,
    scan(onDevice, onError) {
      const m = getManager();
      const seen = new Set<string>();
      try {
        m.startDeviceScan(null, null, (err: any, device: any) => {
          if (err) { onError?.(err?.message ?? String(err)); return; }
          if (!device || seen.has(device.id)) return;
          seen.add(device.id);
          onDevice({
            id: device.id,
            name: device.name ?? device.localName ?? null,
            rssi: typeof device.rssi === "number" ? device.rssi : null,
          });
        });
      } catch (e: any) { onError?.(e?.message ?? "Scan failed"); }
      return () => { try { m.stopDeviceScan(); } catch {} };
    },
    async connect(deviceId) {
      const m = getManager();
      try { m.stopDeviceScan(); } catch {}
      const dev = await m.connectToDevice(deviceId, { timeout: 15000 });
      await dev.discoverAllServicesAndCharacteristics();
      let services: any[] = [];
      try { services = await dev.services(); } catch { services = []; }
      const uuids = services.map((s: any) => (s.uuid || "").toLowerCase());
      return {
        id: dev.id,
        name: dev.name ?? dev.localName ?? null,
        services: uuids,
        hasEqoService: uuids.includes(EQOBAND_SERVICE_UUID.toLowerCase()),
      };
    },
    async disconnect(deviceId) {
      const m = getManager();
      try { await m.cancelDeviceConnection(deviceId); } catch {}
    },
    async streamHR(deviceId, onBpm, onError) {
      const m = getManager();
      try {
        const sub = m.monitorCharacteristicForDevice(
          deviceId,
          EQOBAND_SERVICE_UUID,
          EQOBAND_HR_CHAR_UUID,
          (err: any, ch: any) => {
            if (err) { onError?.(err?.message ?? String(err)); return; }
            if (!ch?.value) return;
            const bytes = b64ToBytes(ch.value);
            if (bytes.length > 0) onBpm(bytes[0]);
          },
        );
        return () => { try { sub.remove(); } catch {} };
      } catch (e: any) {
        onError?.(e?.message ?? "HR stream failed");
        return () => {};
      }
    },
    async streamGestures(deviceId, onGesture, onError) {
      const m = getManager();
      try {
        const sub = m.monitorCharacteristicForDevice(
          deviceId,
          EQOBAND_SERVICE_UUID,
          EQOBAND_GESTURE_CHAR_UUID,
          (err: any, ch: any) => {
            if (err) { onError?.(err?.message ?? String(err)); return; }
            if (!ch?.value) return;
            const bytes = b64ToBytes(ch.value);
            if (bytes.length > 0) {
              const code = bytes[0];
              if (code === 1 || code === 2 || code === 3) {
                onGesture(code as GestureCode);
              }
            }
          },
        );
        return () => { try { sub.remove(); } catch {} };
      } catch (e: any) {
        onError?.(e?.message ?? "Gesture stream failed");
        return () => {};
      }
    },
    async readBattery(deviceId) {
      const m = getManager();
      try {
        const ch = await m.readCharacteristicForDevice(
          deviceId,
          EQOBAND_SERVICE_UUID,
          EQOBAND_BAT_CHAR_UUID,
        );
        if (!ch?.value) return null;
        const bytes = b64ToBytes(ch.value);
        return bytes.length > 0 ? bytes[0] : null;
      } catch {
        return null;
      }
    },
  };
}

export const ble: BleAPI = isWeb
  ? makeStub("Real BLE only runs on a native Android/iOS build. Not available on web preview.")
  : isExpoGo
  ? makeStub("Real BLE cannot run in Expo Go. Publish and generate a native build to test.")
  : makeReal();
