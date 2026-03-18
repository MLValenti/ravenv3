import type { DeviceCommandRequest, DeviceInfo } from "./types";

export type CapabilityGuardResult =
  | { ok: true; request: DeviceCommandRequest; device: DeviceInfo | null }
  | { ok: false; reason: string };

function normalizeDeviceId(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

function findDeviceById(devices: DeviceInfo[], deviceId: string): DeviceInfo | null {
  const exact = devices.find((device) => device.device_id === deviceId);
  if (exact) {
    return exact;
  }

  const numeric = Number(deviceId);
  if (Number.isFinite(numeric)) {
    const normalized = String(Math.trunc(numeric));
    return devices.find((device) => device.device_id === normalized) ?? null;
  }
  return null;
}

function supportedCommandList(device: DeviceInfo): string {
  const supported: string[] = [];
  if (device.capabilities.vibrate) {
    supported.push("vibrate");
  }
  if (device.capabilities.rotate) {
    supported.push("rotate");
  }
  if (device.capabilities.linear) {
    supported.push("linear");
  }
  supported.push("stop");
  return supported.join(", ");
}

export function guardDeviceCommandCapabilities(
  request: DeviceCommandRequest,
  devices: DeviceInfo[],
): CapabilityGuardResult {
  if (request.command === "stop_all") {
    return { ok: true, request, device: null };
  }

  const deviceId = normalizeDeviceId(request.device_id);
  if (!deviceId) {
    return {
      ok: false,
      reason: "Device command is missing device_id.",
    };
  }

  const device = findDeviceById(devices, deviceId);
  if (!device) {
    return {
      ok: false,
      reason: `Device ${deviceId} is not available.`,
    };
  }

  if (request.command === "stop") {
    return {
      ok: true,
      request: { ...request, device_id: device.device_id },
      device,
    };
  }

  if (request.command === "vibrate" && !device.capabilities.vibrate) {
    return {
      ok: false,
      reason: `Device ${device.device_id} does not support vibrate. Supported commands: ${supportedCommandList(device)}.`,
    };
  }
  if (request.command === "rotate" && !device.capabilities.rotate) {
    return {
      ok: false,
      reason: `Device ${device.device_id} does not support rotate. Supported commands: ${supportedCommandList(device)}.`,
    };
  }
  if (request.command === "linear" && !device.capabilities.linear) {
    return {
      ok: false,
      reason: `Device ${device.device_id} does not support linear. Supported commands: ${supportedCommandList(device)}.`,
    };
  }

  return {
    ok: true,
    request: { ...request, device_id: device.device_id },
    device,
  };
}
