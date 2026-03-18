import type {
  DeviceCommandName,
  DeviceCommandParams,
  DeviceCommandRequest,
} from "./types.ts";

type ParseSuccess = { ok: true; request: DeviceCommandRequest };
type ParseFailure = { ok: false; error: string };
type ParseResult = ParseSuccess | ParseFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCommand(value: unknown): DeviceCommandName | null {
  if (
    value === "vibrate" ||
    value === "rotate" ||
    value === "linear" ||
    value === "stop" ||
    value === "stop_all"
  ) {
    return value;
  }
  return null;
}

function parseNumberField(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function parseParams(value: unknown): DeviceCommandParams {
  if (!isRecord(value)) {
    return {};
  }
  const parsed: DeviceCommandParams = {};
  const intensity = parseNumberField(value.intensity);
  const speed = parseNumberField(value.speed);
  const position = parseNumberField(value.position);
  const durationMs = parseNumberField(value.duration_ms);

  if (intensity !== undefined) {
    parsed.intensity = intensity;
  }
  if (speed !== undefined) {
    parsed.speed = speed;
  }
  if (position !== undefined) {
    parsed.position = position;
  }
  if (durationMs !== undefined) {
    parsed.duration_ms = durationMs;
  }
  if (typeof value.clockwise === "boolean") {
    parsed.clockwise = value.clockwise;
  }

  return parsed;
}

export function parseDeviceCommandRequest(payload: unknown): ParseResult {
  if (!isRecord(payload)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const type = payload.type;
  if (type !== "device_command") {
    return { ok: false, error: "Field `type` must be `device_command`." };
  }

  const command = parseCommand(payload.command);
  if (!command) {
    return {
      ok: false,
      error: "Field `command` must be one of: vibrate, rotate, linear, stop, stop_all.",
    };
  }

  let deviceId: string | undefined;
  if (typeof payload.device_id === "string" && payload.device_id.trim().length > 0) {
    deviceId = payload.device_id.trim();
  } else if (typeof payload.device_id === "number" && Number.isFinite(payload.device_id)) {
    deviceId = String(Math.trunc(payload.device_id));
  }

  if (command !== "stop_all" && !deviceId) {
    return {
      ok: false,
      error: "Field `device_id` must be a non-empty string or number for this command.",
    };
  }

  return {
    ok: true,
    request: {
      type: "device_command",
      ...(deviceId ? { device_id: deviceId } : {}),
      command,
      params: parseParams(payload.params),
      opt_in: payload.opt_in === true,
    },
  };
}

function extractJsonCodeBlock(text: string): string | null {
  const match = text.match(/```json\s*([\s\S]*?)```/i);
  if (!match) {
    return null;
  }
  const raw = match[1]?.trim();
  return raw && raw.startsWith("{") && raw.endsWith("}") ? raw : null;
}

function parseUnitValue(raw: string): number | undefined {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized.endsWith("%")) {
    const parsedPercent = Number(normalized.slice(0, -1));
    if (!Number.isFinite(parsedPercent)) {
      return undefined;
    }
    return parsedPercent / 100;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseDurationMs(text: string): number | undefined {
  const match = text.match(
    /\bfor\s+(\d+(?:\.\d+)?)\s*(ms|msec|millisecond|milliseconds|s|sec|secs|second|seconds)\b/i,
  );
  if (!match) {
    return undefined;
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return undefined;
  }
  const unit = match[2].toLowerCase();
  if (
    unit === "s" ||
    unit === "sec" ||
    unit === "secs" ||
    unit === "second" ||
    unit === "seconds"
  ) {
    return Math.round(amount * 1000);
  }
  return Math.round(amount);
}

function parseIntensityLike(text: string): number | undefined {
  const labeled = text.match(
    /\b(?:intensity|power|level)\s*(?:to|at)?\s*(\d+(?:\.\d+)?%?)\b/i,
  );
  if (labeled) {
    return parseUnitValue(labeled[1]);
  }

  const inline = text.match(/\bvibrate(?:\s+at)?\s+(\d+(?:\.\d+)?%?)\b/i);
  if (inline) {
    return parseUnitValue(inline[1]);
  }

  return undefined;
}

function parseSpeed(text: string): number | undefined {
  const labeled = text.match(/\b(?:speed)\s*(?:to|at)?\s*(\d+(?:\.\d+)?%?)\b/i);
  if (labeled) {
    return parseUnitValue(labeled[1]);
  }

  const inline = text.match(/\brotate(?:\s+at)?\s+(\d+(?:\.\d+)?%?)\b/i);
  if (inline) {
    return parseUnitValue(inline[1]);
  }

  return undefined;
}

function parsePosition(text: string): number | undefined {
  const labeled = text.match(
    /\b(?:position|depth)\s*(?:to|at)?\s*(\d+(?:\.\d+)?%?)\b/i,
  );
  return labeled ? parseUnitValue(labeled[1]) : undefined;
}

function parsePlainTextDeviceCommand(text: string): DeviceCommandRequest | null {
  const normalized = text.toLowerCase();
  const deviceMatch = normalized.match(/\bdevice\s*#?\s*([a-z0-9_-]+)\b/i);
  const deviceId = deviceMatch?.[1];

  if (
    /\b(stop(?:\s+all|\s+everything)?|halt\s+all)\b/i.test(normalized) &&
    !deviceId
  ) {
    return {
      type: "device_command",
      command: "stop_all",
      params: {},
    };
  }

  if (!deviceId) {
    return null;
  }

  if (/\b(stop|halt)\b/i.test(normalized)) {
    return {
      type: "device_command",
      device_id: deviceId,
      command: "stop",
      params: {},
    };
  }

  const durationMs = parseDurationMs(text);

  if (/\b(vibrate|vibration|buzz)\b/i.test(normalized)) {
    const intensity = parseIntensityLike(text);
    return {
      type: "device_command",
      device_id: deviceId,
      command: "vibrate",
      params: {
        ...(intensity !== undefined ? { intensity } : {}),
        ...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
      },
    };
  }

  if (/\b(rotate|spin)\b/i.test(normalized)) {
    const speed = parseSpeed(text);
    const clockwise = !/\b(counterclockwise|anticlockwise)\b/i.test(normalized);
    return {
      type: "device_command",
      device_id: deviceId,
      command: "rotate",
      params: {
        ...(speed !== undefined ? { speed } : {}),
        clockwise,
        ...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
      },
    };
  }

  if (/\b(linear|stroke|thrust|position)\b/i.test(normalized)) {
    const position = parsePosition(text);
    return {
      type: "device_command",
      device_id: deviceId,
      command: "linear",
      params: {
        ...(position !== undefined ? { position } : {}),
        ...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
      },
    };
  }

  return null;
}

function extractBalancedJsonObjects(text: string): string[] {
  const results: string[] = [];
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{") {
      continue;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let end = start; end < text.length; end += 1) {
      const ch = text[end];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") {
        depth += 1;
        continue;
      }
      if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          const candidate = text.slice(start, end + 1).trim();
          if (candidate.startsWith("{") && candidate.endsWith("}")) {
            results.push(candidate);
          }
          break;
        }
      }
    }
  }
  return results;
}

function parseLooseObjectCommand(text: string): DeviceCommandRequest | null {
  const commandMatch = text.match(
    /["']?command["']?\s*:\s*["']?(vibrate|rotate|linear|stop|stop_all)["']?/i,
  );
  if (!commandMatch) {
    return null;
  }
  const command = commandMatch[1].toLowerCase() as DeviceCommandName;

  const readNumber = (field: "intensity" | "speed" | "position" | "duration_ms") => {
    const match = text.match(
      new RegExp(`["']?${field}["']?\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, "i"),
    );
    if (!match) {
      return undefined;
    }
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const clockwiseMatch = text.match(/["']?clockwise["']?\s*:\s*(true|false)/i);
  const params: DeviceCommandParams = {};
  const intensity = readNumber("intensity");
  const speed = readNumber("speed");
  const position = readNumber("position");
  const durationMs = readNumber("duration_ms");
  if (intensity !== undefined) {
    params.intensity = intensity;
  }
  if (speed !== undefined) {
    params.speed = speed;
  }
  if (position !== undefined) {
    params.position = position;
  }
  if (durationMs !== undefined) {
    params.duration_ms = durationMs;
  }
  if (clockwiseMatch) {
    params.clockwise = clockwiseMatch[1].toLowerCase() === "true";
  }

  if (command === "stop_all") {
    return {
      type: "device_command",
      command,
      params,
    };
  }

  const deviceIdMatch = text.match(
    /["']?device_id["']?\s*:\s*(?:"([^"]+)"|'([^']+)'|([a-z0-9_-]+))/i,
  );
  const deviceId = (deviceIdMatch?.[1] ?? deviceIdMatch?.[2] ?? deviceIdMatch?.[3] ?? "").trim();
  if (!deviceId) {
    return null;
  }

  return {
    type: "device_command",
    device_id: deviceId,
    command,
    params,
  };
}

export function extractJsonCandidateFromAssistantText(text: string): string | null {
  const fromBlock = extractJsonCodeBlock(text);
  if (fromBlock) {
    return fromBlock;
  }

  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  for (const candidate of extractBalancedJsonObjects(text)) {
    try {
      const parsed = JSON.parse(candidate) as { type?: unknown };
      if (parsed.type === "device_command") {
        return candidate;
      }
    } catch {
      // Ignore non-json text blocks.
    }
  }
  return null;
}

export function parseDeviceCommandFromAssistantText(text: string): ParseResult {
  const candidate = extractJsonCandidateFromAssistantText(text);
  if (candidate) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      return parseDeviceCommandRequest(parsed);
    } catch {
      const loose = parseLooseObjectCommand(candidate);
      if (loose) {
        return parseDeviceCommandRequest(loose);
      }
    }
  }

  const looseInline = parseLooseObjectCommand(text);
  if (looseInline) {
    return parseDeviceCommandRequest(looseInline);
  }

  const fromPlainText = parsePlainTextDeviceCommand(text);
  if (fromPlainText) {
    return parseDeviceCommandRequest(fromPlainText);
  }

  return { ok: false, error: "No valid device action found." };
}
