import type { DeviceCapabilities } from "./types.ts";

export type TransportDevice = {
  id: string;
  name: string;
  capabilities: DeviceCapabilities;
};

export type DeviceTransport = {
  connect: (url: string) => Promise<void>;
  disconnect: () => Promise<void>;
  startScanning: () => Promise<void>;
  stopAllDevices: () => Promise<void>;
  stopDevice: (deviceId: string) => Promise<void>;
  vibrate: (deviceId: string, intensity: number) => Promise<void>;
  rotate: (deviceId: string, speed: number, clockwise: boolean) => Promise<void>;
  linear: (deviceId: string, position: number, durationMs: number | null) => Promise<void>;
  isConnected: () => boolean;
  isScanning: () => boolean;
  listDevices: () => TransportDevice[];
};
