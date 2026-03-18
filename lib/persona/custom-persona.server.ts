import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_CUSTOM_PERSONA_SPEC,
  buildCustomPersonaPack,
  buildCustomPersonaSourceText,
  normalizeCustomPersonaSpec,
  stampCustomPersonaSpec,
  type CustomPersonaSpec,
} from "./custom-persona.ts";

function customPersonaSpecPath(): string {
  return (
    process.env.RAVEN_CUSTOM_PERSONA_SPEC_FILE?.trim() ||
    path.join(process.cwd(), "data", "persona", "specs", "custom.json")
  );
}

function customPersonaPackPath(): string {
  return (
    process.env.RAVEN_CUSTOM_PERSONA_PACK_FILE?.trim() ||
    path.join(process.cwd(), "data", "persona", "packs", "custom.json")
  );
}

function customPersonaSourcePath(): string {
  return (
    process.env.RAVEN_CUSTOM_PERSONA_SOURCE_FILE?.trim() ||
    path.join(process.cwd(), "data", "persona", "sources", "Custom Raven.txt")
  );
}

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJsonFile(filePath: string): unknown | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

export function loadCustomPersonaSpec(): CustomPersonaSpec {
  const raw = readJsonFile(customPersonaSpecPath());
  if (!raw) {
    return DEFAULT_CUSTOM_PERSONA_SPEC;
  }
  return normalizeCustomPersonaSpec(raw);
}

export function saveCustomPersonaSpec(input: unknown): CustomPersonaSpec {
  const stamped = stampCustomPersonaSpec(normalizeCustomPersonaSpec(input));
  const specFile = customPersonaSpecPath();
  const packFile = customPersonaPackPath();
  const sourceFile = customPersonaSourcePath();

  ensureDir(specFile);
  ensureDir(packFile);
  ensureDir(sourceFile);

  fs.writeFileSync(specFile, `${JSON.stringify(stamped, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    packFile,
    `${JSON.stringify(buildCustomPersonaPack(stamped), null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(sourceFile, `${buildCustomPersonaSourceText(stamped)}\n`, "utf8");

  return stamped;
}

export function loadCustomPersonaPackPreview() {
  return buildCustomPersonaPack(loadCustomPersonaSpec());
}
