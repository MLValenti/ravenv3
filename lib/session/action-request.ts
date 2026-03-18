import {
  extractJsonCandidateFromAssistantText,
  parseDeviceCommandFromAssistantText,
} from "../devices/action-schema.ts";
import type { DeviceCommandRequest } from "../devices/types.ts";

export type DeviceActionRequest = DeviceCommandRequest;

type ParseResult =
  | { ok: true; request: DeviceActionRequest }
  | { ok: false; error: string };

export function extractActionJsonBlock(text: string): string | null {
  return extractJsonCandidateFromAssistantText(text);
}

export function stripActionJsonBlock(text: string): string {
  const withoutCodeBlock = text.replace(/```json\s*[\s\S]*?```/gi, "").trim();
  const withoutFenceMarkers = withoutCodeBlock
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  const inlineJson = extractJsonCandidateFromAssistantText(withoutFenceMarkers);
  const withoutInlineJson = inlineJson
    ? withoutFenceMarkers.replace(inlineJson, "").trim()
    : withoutFenceMarkers;
  const withoutStandaloneJsonLines = withoutInlineJson
    .split("\n")
    .filter((line) => line.trim().toLowerCase() !== "json")
    .join("\n")
    .trim();
  const withoutTrailingJsonWord = withoutStandaloneJsonLines
    .replace(/\s+json\s*$/i, "")
    .trim();
  return withoutTrailingJsonWord.replace(/\n{3,}/g, "\n\n").trim();
}

export function parseDeviceActionRequest(text: string): ParseResult {
  return parseDeviceCommandFromAssistantText(text);
}

export function formatDeviceActionForDisplay(request: DeviceActionRequest): string {
  if (request.command === "stop_all") {
    return "Device command: stop all devices.";
  }
  if (request.command === "stop") {
    return `Device command: stop device ${request.device_id ?? "unknown"}.`;
  }

  const parts: string[] = [
    `Device command: ${request.command} device ${request.device_id ?? "unknown"}`,
  ];
  if (typeof request.params?.intensity === "number") {
    parts.push(`intensity ${request.params.intensity.toFixed(2)}`);
  }
  if (typeof request.params?.speed === "number") {
    parts.push(`speed ${request.params.speed.toFixed(2)}`);
  }
  if (typeof request.params?.position === "number") {
    parts.push(`position ${request.params.position.toFixed(2)}`);
  }
  if (typeof request.params?.clockwise === "boolean") {
    parts.push(`clockwise ${request.params.clockwise ? "yes" : "no"}`);
  }
  if (typeof request.params?.duration_ms === "number") {
    parts.push(`duration ${Math.round(request.params.duration_ms)}ms`);
  }

  return `${parts.join(" ")}.`;
}
