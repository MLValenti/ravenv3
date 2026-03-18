import {
  ButtplugClient,
  ButtplugNodeWebsocketClientConnector,
  DeviceOutput,
  OutputType,
} from "buttplug";

import type { DeviceTransport, TransportDevice } from "./transport.ts";

function toTransportDevice(device: {
  index: number;
  name: string;
  displayName?: string;
  hasOutput: (outputType: OutputType) => boolean;
}): TransportDevice {
  return {
    id: String(device.index),
    name: device.displayName ?? device.name,
    capabilities: {
      vibrate: device.hasOutput(OutputType.Vibrate),
      rotate: device.hasOutput(OutputType.Rotate),
      linear:
        device.hasOutput(OutputType.Position) ||
        device.hasOutput(OutputType.PositionWithDuration),
    },
  };
}

export class ButtplugDeviceTransport implements DeviceTransport {
  private client: ButtplugClient | null = null;

  private scanning = false;

  private readonly onDisconnect = () => {
    this.scanning = false;
  };

  private readonly onScanningFinished = () => {
    this.scanning = false;
  };

  isConnected() {
    return this.client?.connected === true;
  }

  isScanning() {
    return this.scanning;
  }

  async connect(url: string) {
    await this.disconnect();

    const client = new ButtplugClient("Raven Intiface Client");
    const connector = new ButtplugNodeWebsocketClientConnector(url);
    await client.connect(connector);
    client.on("disconnect", this.onDisconnect);
    client.on("scanningfinished", this.onScanningFinished);
    this.client = client;
    this.scanning = false;
  }

  async disconnect() {
    if (!this.client) {
      this.scanning = false;
      return;
    }

    const previous = this.client;
    this.client = null;
    this.scanning = false;
    previous.removeListener("disconnect", this.onDisconnect);
    previous.removeListener("scanningfinished", this.onScanningFinished);
    await previous.disconnect().catch(() => undefined);
  }

  async startScanning() {
    const client = this.requireClient();
    await client.startScanning();
    this.scanning = true;
  }

  async stopAllDevices() {
    const client = this.requireClient();
    await client.stopAllDevices();
  }

  async stopDevice(deviceId: string) {
    const device = this.requireDevice(deviceId);
    await device.stop();
  }

  async vibrate(deviceId: string, intensity: number) {
    const device = this.requireDevice(deviceId);
    await device.runOutput(DeviceOutput.Vibrate.percent(intensity));
  }

  async rotate(deviceId: string, speed: number, clockwise: boolean) {
    void clockwise;
    const device = this.requireDevice(deviceId);
    await device.runOutput(DeviceOutput.Rotate.percent(speed));
  }

  async linear(deviceId: string, position: number, durationMs: number | null) {
    const device = this.requireDevice(deviceId);
    if (device.hasOutput(OutputType.PositionWithDuration)) {
      const duration = durationMs && durationMs > 0 ? durationMs : 1000;
      await device.runOutput(DeviceOutput.PositionWithDuration.percent(position, duration));
      return;
    }

    await device.runOutput(DeviceOutput.Position.percent(position));
  }

  listDevices() {
    if (!this.client || !this.client.connected) {
      return [];
    }

    return Array.from(this.client.devices.values()).map((device) => toTransportDevice(device));
  }

  private requireClient() {
    if (!this.client || !this.client.connected) {
      throw new Error("Intiface client is not connected.");
    }
    return this.client;
  }

  private requireDevice(deviceId: string) {
    const client = this.requireClient();
    const target = Array.from(client.devices.values()).find(
      (candidate) => String(candidate.index) === deviceId,
    );

    if (!target) {
      throw new Error(`Device ${deviceId} is not available.`);
    }

    return target;
  }
}
