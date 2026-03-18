import assert from "node:assert/strict";
import test from "node:test";

import { guardDeviceCommandCapabilities } from "../lib/devices/capability-guard.ts";
import type { DeviceInfo } from "../lib/devices/types.ts";

const devices: DeviceInfo[] = [
  {
    device_id: "0",
    name: "Device Zero",
    capabilities: {
      vibrate: true,
      rotate: false,
      linear: false,
    },
    last_seen: Date.now(),
  },
];

test("allows supported vibrate command", () => {
  const result = guardDeviceCommandCapabilities(
    {
      type: "device_command",
      device_id: "0",
      command: "vibrate",
      params: { intensity: 0.3, duration_ms: 1500 },
    },
    devices,
  );
  assert.equal(result.ok, true);
});

test("blocks unsupported rotate command", () => {
  const result = guardDeviceCommandCapabilities(
    {
      type: "device_command",
      device_id: "0",
      command: "rotate",
      params: { speed: 0.5, duration_ms: 1000 },
    },
    devices,
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /does not support rotate/i);
  }
});

test("blocks command when device is unavailable", () => {
  const result = guardDeviceCommandCapabilities(
    {
      type: "device_command",
      device_id: "99",
      command: "vibrate",
      params: { intensity: 0.2 },
    },
    devices,
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /not available/i);
  }
});
