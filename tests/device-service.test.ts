import assert from "node:assert/strict";
import test from "node:test";

import { createDeviceService } from "../lib/devices/device-service.ts";
import type { DeviceTransport, TransportDevice } from "../lib/devices/transport.ts";

class MockTransport implements DeviceTransport {
  public connected = false;

  public scanning = false;

  public devices: TransportDevice[] = [];

  public connectCalls: string[] = [];

  public disconnectCalls = 0;

  public startScanningCalls = 0;

  public stopAllCalls = 0;

  public stopDeviceCalls: string[] = [];

  public vibrateCalls: Array<{ deviceId: string; intensity: number }> = [];

  public rotateCalls: Array<{ deviceId: string; speed: number; clockwise: boolean }> = [];

  public linearCalls: Array<{ deviceId: string; position: number; durationMs: number | null }> = [];

  async connect(url: string) {
    this.connectCalls.push(url);
    this.connected = true;
  }

  async disconnect() {
    this.disconnectCalls += 1;
    this.connected = false;
    this.scanning = false;
  }

  async startScanning() {
    this.startScanningCalls += 1;
    this.scanning = true;
  }

  async stopAllDevices() {
    this.stopAllCalls += 1;
  }

  async stopDevice(deviceId: string) {
    this.stopDeviceCalls.push(deviceId);
  }

  async vibrate(deviceId: string, intensity: number) {
    this.vibrateCalls.push({ deviceId, intensity });
  }

  async rotate(deviceId: string, speed: number, clockwise: boolean) {
    this.rotateCalls.push({ deviceId, speed, clockwise });
  }

  async linear(deviceId: string, position: number, durationMs: number | null) {
    this.linearCalls.push({ deviceId, position, durationMs });
  }

  isConnected() {
    return this.connected;
  }

  isScanning() {
    return this.scanning;
  }

  listDevices() {
    return this.devices;
  }
}

class HangingStopTransport extends MockTransport {
  async stopDevice(_deviceId: string) {
    void _deviceId;
    return await new Promise<void>(() => undefined);
  }
}

function createDefaultDeviceList(): TransportDevice[] {
  return [
    {
      id: "1",
      name: "Device One",
      capabilities: { vibrate: true, rotate: true, linear: true },
    },
    {
      id: "2",
      name: "Device Two",
      capabilities: { vibrate: true, rotate: false, linear: false },
    },
  ];
}

test("connect sets connected true", async () => {
  const transport = new MockTransport();
  transport.devices = createDefaultDeviceList();
  const service = createDeviceService(transport);

  const status = await service.connect("ws://127.0.0.1:12345");
  assert.equal(status.connected, true);
  assert.equal(status.device_count, 2);
  assert.equal(transport.connectCalls.length, 1);
  assert.equal(transport.startScanningCalls, 1);
});

test("list returns devices from registry", async () => {
  const transport = new MockTransport();
  transport.devices = createDefaultDeviceList();
  const service = createDeviceService(transport);

  await service.connect("ws://127.0.0.1:12345");
  const devices = service.listDevices();
  assert.equal(devices.length, 2);
  assert.equal(devices[0]?.device_id, "1");
  assert.equal(devices[0]?.capabilities.rotate, true);
});

test("command clamps values and enforces rate limits", async () => {
  const transport = new MockTransport();
  transport.devices = createDefaultDeviceList();
  let nowMs = 1_000;
  const service = createDeviceService(transport, {
    now: () => nowMs,
    minCommandIntervalMs: 0,
    rateLimitWindowMs: 1_000,
    rateLimitMaxCommands: 1,
  });

  await service.connect("ws://127.0.0.1:12345");
  const first = await service.executeCommand({
    type: "device_command",
    device_id: "1",
    command: "vibrate",
    params: { intensity: 3.5, duration_ms: 99_999 },
    opt_in: true,
  });
  assert.equal(first.ok, true);
  assert.equal(transport.vibrateCalls.length, 1);
  assert.equal(transport.vibrateCalls[0]?.intensity, 1);
  assert.equal(first.ok ? first.applied.duration_ms : 0, 30_000);

  const second = await service.executeCommand({
    type: "device_command",
    device_id: "1",
    command: "vibrate",
    params: { intensity: 0.5 },
    opt_in: true,
  });
  assert.equal(second.ok, false);
  assert.match(second.ok ? "" : second.error, /rate limit/i);

  nowMs += 2_000;
  const third = await service.executeCommand({
    type: "device_command",
    device_id: "1",
    command: "vibrate",
    params: { intensity: -5 },
    opt_in: true,
  });
  assert.equal(third.ok, true);
  assert.equal(transport.vibrateCalls.at(-1)?.intensity, 0);
});

test("stop all sends stop request", async () => {
  const transport = new MockTransport();
  transport.devices = createDefaultDeviceList();
  const service = createDeviceService(transport);
  await service.connect("ws://127.0.0.1:12345");

  const result = await service.stopAll("test");
  assert.equal(result.ok, true);
  assert.equal(result.stopped, 2);
  assert.equal(transport.stopAllCalls, 1);
});

test("stop_all command executes stop all path", async () => {
  const transport = new MockTransport();
  transport.devices = createDefaultDeviceList();
  const service = createDeviceService(transport);
  await service.connect("ws://127.0.0.1:12345");

  const result = await service.executeCommand({
    type: "device_command",
    command: "stop_all",
    params: {},
    opt_in: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.device_id : "", "all");
  assert.equal(transport.stopAllCalls, 1);
});

test("timeout in stop command does not deadlock later commands", async () => {
  const transport = new HangingStopTransport();
  transport.devices = createDefaultDeviceList();
  const service = createDeviceService(transport, {
    transportCommandTimeoutMs: 20,
  });
  await service.connect("ws://127.0.0.1:12345");

  const stopResult = await service.executeCommand({
    type: "device_command",
    device_id: "1",
    command: "stop",
    params: {},
    opt_in: true,
  });
  assert.equal(stopResult.ok, false);
  assert.match(stopResult.ok ? "" : stopResult.error, /timed out/i);

  const nextResult = await service.executeCommand({
    type: "device_command",
    device_id: "1",
    command: "vibrate",
    params: { intensity: 0.2 },
    opt_in: true,
  });
  assert.equal(nextResult.ok, true);
});
