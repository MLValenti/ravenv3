import fs from "node:fs";
import path from "node:path";

import { loadCustomPersonaPackPreview } from "./custom-persona.server";
import { normalizePersonaStylePack, type PersonaStylePack } from "./style-pack";

const PACKS_DIR = path.join(process.cwd(), "data", "persona", "packs");
const DEFAULT_PACK_ID = "default";

function sanitizePackId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
}

function readPackFile(packId: string): unknown | null {
  const safeId = sanitizePackId(packId);
  if (!safeId) {
    return null;
  }
  const filePath = path.join(PACKS_DIR, `${safeId}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function loadPersonaStylePack(packId: string | null | undefined): PersonaStylePack | null {
  const requested =
    typeof packId === "string" && packId.trim().length > 0 ? packId : DEFAULT_PACK_ID;
  if (sanitizePackId(requested) === "custom") {
    return loadCustomPersonaPackPreview();
  }
  const requestedRaw = readPackFile(requested);
  const requestedPack = normalizePersonaStylePack(requestedRaw);
  if (requestedPack) {
    return requestedPack;
  }
  if (sanitizePackId(requested) === DEFAULT_PACK_ID) {
    return null;
  }
  const fallbackRaw = readPackFile(DEFAULT_PACK_ID);
  return normalizePersonaStylePack(fallbackRaw);
}
