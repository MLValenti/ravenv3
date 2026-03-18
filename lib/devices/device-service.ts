import { ButtplugDeviceTransport } from "./buttplug-transport.ts";
import type { DeviceTransport } from "./transport.ts";
import type {
  DeviceActionResult,
  DeviceCommandName,
  DeviceCommandParams,
  DeviceCommandRequest,
  DeviceConnectionStatus,
  DeviceInfo,
} from "./types.ts";
import { DEFAULT_SETTINGS } from "../settings.ts";

type TimerHandle = ReturnType<typeof setTimeout>;

type DeviceServiceOptions = {
  now?: () => number;
  setTimeoutFn?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimeoutFn?: (timer: TimerHandle) => void;
  maxDurationMs?: number;
  minDurationMs?: number;
  rateLimitWindowMs?: number;
  rateLimitMaxCommands?: number;
  minCommandIntervalMs?: number;
  transportCommandTimeoutMs?: number;
};

const DEFAULT_MAX_DURATION_MS = 30_000;
const DEFAULT_MIN_DURATION_MS = 100;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 2_000;
const DEFAULT_RATE_LIMIT_MAX_COMMANDS = 8;
const DEFAULT_MIN_COMMAND_INTERVAL_MS = 150;
const DEFAULT_TRANSPORT_COMMAND_TIMEOUT_MS = 4_000;

type AppliedParams = {
  intensity?: number;
  speed?: number;
  clockwise?: boolean;
  position?: number;
  duration_ms?: number;
};

type CommandExecutionOutcome = {
  targetDeviceId: string;
  applied: AppliedParams;
};

type ExecuteContext = {
  device: DeviceInfo;
  command: DeviceCommandName;
  params: DeviceCommandParams;
};

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Unknown device error.";
}

export class DeviceService {
  private readonly transport: DeviceTransport;

  private readonly now: () => number;

  private readonly setTimeoutFn: (callback: () => void, delayMs: number) => TimerHandle;

  private readonly clearTimeoutFn: (timer: TimerHandle) => void;

  private readonly maxDurationMs: number;

  private readonly minDurationMs: number;

  private readonly rateLimitWindowMs: number;

  private readonly rateLimitMaxCommands: number;

  private readonly minCommandIntervalMs: number;

  private readonly transportCommandTimeoutMs: number;

  private connectedUrl = DEFAULT_SETTINGS.intifaceWsUrl;

  private lastError: string | null = null;

  private devices = new Map<string, DeviceInfo>();

  private commandQueue: Promise<void> = Promise.resolve();

  private readonly stopTimers = new Map<string, TimerHandle>();

  private readonly rateHistory = new Map<string, number[]>();

  private readonly lastCommandAt = new Map<string, number>();

  constructor(transport: DeviceTransport, options: DeviceServiceOptions = {}) {
    this.transport = transport;
    this.now = options.now ?? (() => Date.now());
    this.setTimeoutFn = options.setTimeoutFn ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimeoutFn = options.clearTimeoutFn ?? ((timer) => clearTimeout(timer));
    this.maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
    this.minDurationMs = options.minDurationMs ?? DEFAULT_MIN_DURATION_MS;
    this.rateLimitWindowMs = options.rateLimitWindowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS;
    this.rateLimitMaxCommands = options.rateLimitMaxCommands ?? DEFAULT_RATE_LIMIT_MAX_COMMANDS;
    this.minCommandIntervalMs = options.minCommandIntervalMs ?? DEFAULT_MIN_COMMAND_INTERVAL_MS;
    this.transportCommandTimeoutMs =
      options.transportCommandTimeoutMs ?? DEFAULT_TRANSPORT_COMMAND_TIMEOUT_MS;
  }

  getStatus(): DeviceConnectionStatus {
    return {
      connected: this.transport.isConnected(),
      scanning: this.transport.isScanning(),
      url: this.connectedUrl,
      last_error: this.lastError,
      device_count: this.devices.size,
    };
  }

  listDevices(): DeviceInfo[] {
    this.syncRegistry();
    return Array.from(this.devices.values());
  }

  async connect(url: string): Promise<DeviceConnectionStatus> {
    return this.enqueue(async () => {
      this.connectedUrl = url;
      this.lastError = null;

      if (this.transport.isConnected()) {
        await this.safeStopAllDevices();
        await this.withTransportTimeout(
          this.transport.disconnect(),
          "Disconnect request timed out.",
        );
      }

      try {
        await this.withTransportTimeout(this.transport.connect(url), "Connect request timed out.");
        await this.withTransportTimeout(
          this.transport.startScanning(),
          "Start scanning request timed out.",
        );
      } catch (error) {
        this.lastError = toErrorMessage(error);
        this.devices.clear();
        return this.getStatus();
      }

      this.syncRegistry();
      return this.getStatus();
    });
  }

  async disconnect(): Promise<DeviceConnectionStatus> {
    return this.enqueue(async () => {
      await this.safeStopAllDevices();
      this.clearStopTimers();
      this.rateHistory.clear();
      this.lastCommandAt.clear();
      this.devices.clear();
      this.lastError = null;
      await this.withTransportTimeout(
        this.transport.disconnect(),
        "Disconnect request timed out.",
      ).catch(() => undefined);
      return this.getStatus();
    });
  }

  async stopAll(reason = "manual"): Promise<{ ok: true; reason: string; stopped: number }> {
    return this.enqueue(async () => {
      const stopped = this.devices.size;
      this.clearStopTimers();
      this.rateHistory.clear();
      this.lastCommandAt.clear();
      await this.safeStopAllDevices();
      this.lastError = null;
      return { ok: true, reason, stopped };
    });
  }

  async executeCommand(request: DeviceCommandRequest): Promise<DeviceActionResult> {
    return this.enqueue(async () => {
      this.syncRegistry();

      if (!this.transport.isConnected()) {
        return { ok: false, error: "Intiface is not connected." };
      }

      if (request.opt_in !== true) {
        return {
          ok: false,
          error: "Device commands require explicit opt-in. Enable opt-in and retry.",
        };
      }

      const context = this.prepareExecutionContext(request);
      if ("error" in context) {
        return context;
      }

      if (context.command !== "stop" && context.command !== "stop_all") {
        const rateLimitError = this.consumeRateLimitToken(context.device.device_id);
        if (rateLimitError) {
          return { ok: false, error: rateLimitError };
        }
      }

      try {
        const outcome = await this.runCommand(context);
        this.lastError = null;
        return {
          ok: true,
          device_id: outcome.targetDeviceId,
          command: context.command,
          applied: outcome.applied,
        };
      } catch (error) {
        const message = toErrorMessage(error);
        this.lastError = message;
        await this.safeStopAllDevices();
        return { ok: false, error: message };
      }
    });
  }

  private prepareExecutionContext(
    request: DeviceCommandRequest,
  ): ExecuteContext | { ok: false; error: string } {
    const command = request.command;
    if (command === "stop_all") {
      return {
        device: {
          device_id: "all",
          name: "All devices",
          capabilities: { vibrate: true, rotate: true, linear: true },
          last_seen: this.now(),
        },
        command,
        params: request.params ?? {},
      };
    }

    const deviceId = request.device_id ?? "";
    const device = this.devices.get(deviceId);
    if (!device) {
      return { ok: false, error: `Device ${deviceId || "unknown"} is not available.` };
    }

    if (command !== "stop") {
      if (command === "vibrate" && !device.capabilities.vibrate) {
        return { ok: false, error: `Device ${request.device_id} does not support vibrate.` };
      }
      if (command === "rotate" && !device.capabilities.rotate) {
        return { ok: false, error: `Device ${request.device_id} does not support rotate.` };
      }
      if (command === "linear" && !device.capabilities.linear) {
        return { ok: false, error: `Device ${request.device_id} does not support linear.` };
      }
    }

    return {
      device,
      command,
      params: request.params ?? {},
    };
  }

  private async runCommand(context: ExecuteContext): Promise<CommandExecutionOutcome> {
    const params = context.params;
    const durationMs = this.normalizeDuration(params.duration_ms);

    if (context.command === "stop_all") {
      this.clearStopTimers();
      await this.safeStopAllDevices();
      return { targetDeviceId: "all", applied: {} };
    }

    if (context.command === "stop") {
      this.cancelStopTimer(context.device.device_id);
      await this.withTransportTimeout(
        this.transport.stopDevice(context.device.device_id),
        `Stop command timed out for device ${context.device.device_id}.`,
      );
      return { targetDeviceId: context.device.device_id, applied: {} };
    }

    if (context.command === "vibrate") {
      const intensity = clampUnit(
        typeof params.intensity === "number" ? params.intensity : 0,
      );
      await this.withTransportTimeout(
        this.transport.vibrate(context.device.device_id, intensity),
        `Vibrate command timed out for device ${context.device.device_id}.`,
      );
      this.scheduleStop(context.device.device_id, durationMs);
      return {
        targetDeviceId: context.device.device_id,
        applied: {
          intensity,
          ...(durationMs !== null ? { duration_ms: durationMs } : {}),
        },
      };
    }

    if (context.command === "rotate") {
      const speed = clampUnit(typeof params.speed === "number" ? params.speed : 0);
      const clockwise = params.clockwise !== false;
      await this.withTransportTimeout(
        this.transport.rotate(context.device.device_id, speed, clockwise),
        `Rotate command timed out for device ${context.device.device_id}.`,
      );
      this.scheduleStop(context.device.device_id, durationMs);
      return {
        targetDeviceId: context.device.device_id,
        applied: {
          speed,
          clockwise,
          ...(durationMs !== null ? { duration_ms: durationMs } : {}),
        },
      };
    }

    const position = clampUnit(typeof params.position === "number" ? params.position : 0);
    await this.withTransportTimeout(
      this.transport.linear(context.device.device_id, position, durationMs),
      `Linear command timed out for device ${context.device.device_id}.`,
    );
    this.scheduleStop(context.device.device_id, durationMs);
    return {
      targetDeviceId: context.device.device_id,
      applied: {
        position,
        ...(durationMs !== null ? { duration_ms: durationMs } : {}),
      },
    };
  }

  private scheduleStop(deviceId: string, durationMs: number | null) {
    this.cancelStopTimer(deviceId);
    if (durationMs === null) {
      return;
    }

    const timer = this.setTimeoutFn(() => {
      this.stopTimers.delete(deviceId);
      void this.enqueue(async () => {
        if (!this.transport.isConnected()) {
          return;
        }
        await this.stopDeviceBestEffort(deviceId);
      });
    }, durationMs);
    this.stopTimers.set(deviceId, timer);
  }

  private normalizeDuration(durationMs: number | undefined): number | null {
    if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) {
      return null;
    }
    if (durationMs <= 0) {
      return null;
    }
    const bounded = Math.max(this.minDurationMs, Math.min(this.maxDurationMs, durationMs));
    return Math.round(bounded);
  }

  private consumeRateLimitToken(deviceId: string): string | null {
    const now = this.now();
    const recent = (this.rateHistory.get(deviceId) ?? []).filter(
      (timestamp) => now - timestamp <= this.rateLimitWindowMs,
    );

    const previous = this.lastCommandAt.get(deviceId);
    if (previous !== undefined && now - previous < this.minCommandIntervalMs) {
      return `Rate limit exceeded for device ${deviceId}.`;
    }
    if (recent.length >= this.rateLimitMaxCommands) {
      return `Rate limit exceeded for device ${deviceId}.`;
    }

    recent.push(now);
    this.rateHistory.set(deviceId, recent);
    this.lastCommandAt.set(deviceId, now);
    return null;
  }

  private syncRegistry() {
    if (!this.transport.isConnected()) {
      this.devices.clear();
      return;
    }

    const now = this.now();
    const latest = this.transport.listDevices();
    const next = new Map<string, DeviceInfo>();

    for (const device of latest) {
      const existing = this.devices.get(device.id);
      next.set(device.id, {
        device_id: device.id,
        name: device.name,
        capabilities: device.capabilities,
        last_seen: existing?.last_seen ?? now,
      });
    }

    for (const [deviceId] of this.devices) {
      if (!next.has(deviceId)) {
        this.cancelStopTimer(deviceId);
        this.rateHistory.delete(deviceId);
        this.lastCommandAt.delete(deviceId);
      }
    }

    for (const [deviceId, value] of next) {
      value.last_seen = now;
      next.set(deviceId, value);
    }

    this.devices = next;
  }

  private cancelStopTimer(deviceId: string) {
    const timer = this.stopTimers.get(deviceId);
    if (!timer) {
      return;
    }
    this.clearTimeoutFn(timer);
    this.stopTimers.delete(deviceId);
  }

  private clearStopTimers() {
    for (const timer of this.stopTimers.values()) {
      this.clearTimeoutFn(timer);
    }
    this.stopTimers.clear();
  }

  private async safeStopAllDevices() {
    if (!this.transport.isConnected()) {
      return;
    }
    await this.withTransportTimeout(
      this.transport.stopAllDevices(),
      "Stop all request timed out.",
    ).catch((error) => {
      this.lastError = toErrorMessage(error);
    });
  }

  private async stopDeviceBestEffort(deviceId: string) {
    await this.withTransportTimeout(
      this.transport.stopDevice(deviceId),
      `Timed stop failed for device ${deviceId}.`,
    ).catch(async () => {
      const known = this.devices.get(deviceId);
      if (!known) {
        return;
      }
      const attempts: Array<Promise<unknown>> = [];
      if (known.capabilities.vibrate) {
        attempts.push(this.transport.vibrate(deviceId, 0));
      }
      if (known.capabilities.rotate) {
        attempts.push(this.transport.rotate(deviceId, 0, true));
      }
      if (known.capabilities.linear) {
        attempts.push(this.transport.linear(deviceId, 0, 250));
      }
      await Promise.allSettled(attempts);
    });
  }

  private async withTransportTimeout<T>(operation: Promise<T>, timeoutMessage: string): Promise<T> {
    let timer: TimerHandle | null = null;
    try {
      const timeoutPromise = new Promise<T>((_, reject) => {
        timer = this.setTimeoutFn(() => {
          reject(new Error(timeoutMessage));
        }, this.transportCommandTimeoutMs);
      });
      return await Promise.race([operation, timeoutPromise]);
    } finally {
      if (timer) {
        this.clearTimeoutFn(timer);
      }
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.commandQueue.then(operation, operation);
    this.commandQueue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }
}

type DeviceServiceGlobal = typeof globalThis & {
  __ravenDeviceService?: DeviceService;
};

export function createDeviceService(transport: DeviceTransport, options: DeviceServiceOptions = {}) {
  return new DeviceService(transport, options);
}

export function getDeviceService() {
  const scoped = globalThis as DeviceServiceGlobal;
  if (!scoped.__ravenDeviceService) {
    scoped.__ravenDeviceService = new DeviceService(new ButtplugDeviceTransport());
  }
  return scoped.__ravenDeviceService;
}
