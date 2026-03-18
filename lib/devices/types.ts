export type DeviceCapabilities = {
  vibrate: boolean;
  rotate: boolean;
  linear: boolean;
};

export type DeviceInfo = {
  device_id: string;
  name: string;
  capabilities: DeviceCapabilities;
  last_seen: number;
};

export type DeviceConnectionStatus = {
  connected: boolean;
  scanning: boolean;
  url: string;
  last_error: string | null;
  device_count: number;
};

export type DeviceCommandName =
  | "vibrate"
  | "rotate"
  | "linear"
  | "stop"
  | "stop_all";

export type DeviceCommandParams = {
  intensity?: number;
  speed?: number;
  clockwise?: boolean;
  position?: number;
  duration_ms?: number;
};

export type DeviceCommandRequest = {
  type: "device_command";
  device_id?: string;
  command: DeviceCommandName;
  params?: DeviceCommandParams;
  opt_in?: boolean;
};

export type DeviceCommandResult = {
  ok: true;
  device_id: string;
  command: DeviceCommandName;
  applied: {
    intensity?: number;
    speed?: number;
    clockwise?: boolean;
    position?: number;
    duration_ms?: number;
  };
};

export type DeviceActionError = {
  ok: false;
  error: string;
};

export type DeviceActionResult = DeviceCommandResult | DeviceActionError;
