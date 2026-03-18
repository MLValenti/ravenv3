import fs from "node:fs";
import path from "node:path";

import { buildPersonaStylePackFromTexts } from "../../lib/persona/style-pack-builder.ts";

type BuildInput = {
  id: string;
  name: string;
  sourceDir: string;
  outputFile: string;
};

function sanitizeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
}

function readSourceTexts(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const files = fs
    .readdirSync(dir)
    .filter((file) => file.toLowerCase().endsWith(".txt"))
    .map((file) => path.join(dir, file));
  const texts: string[] = [];
  for (const file of files) {
    try {
      texts.push(fs.readFileSync(file, "utf8"));
    } catch {
      // Ignore unreadable files and continue.
    }
  }
  return texts;
}

function buildPack(input: BuildInput) {
  const texts = readSourceTexts(input.sourceDir);
  if (texts.length === 0) {
    throw new Error(`No .txt sources found in ${input.sourceDir}`);
  }
  return buildPersonaStylePackFromTexts({
    id: sanitizeId(input.id) || "custom",
    name: input.name,
    texts,
  });
}

function parseArgs(argv: string[]): BuildInput {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (!current || !current.startsWith("--") || !next) {
      continue;
    }
    args.set(current.slice(2), next);
    index += 1;
  }

  const root = process.cwd();
  const id = sanitizeId(args.get("id") ?? "custom");
  const name = args.get("name") ?? "Custom Persona Pack";
  const sourceDir = path.resolve(
    root,
    args.get("source") ?? path.join("data", "persona", "sources"),
  );
  const outputFile = path.resolve(
    root,
    args.get("out") ?? path.join("data", "persona", "packs", `${id}.json`),
  );
  return { id, name, sourceDir, outputFile };
}

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function main(): void {
  const input = parseArgs(process.argv.slice(2));
  const pack = buildPack(input);
  ensureDir(input.outputFile);
  fs.writeFileSync(input.outputFile, JSON.stringify(pack, null, 2), "utf8");
  process.stdout.write(`Wrote persona pack to ${input.outputFile}\n`);
}

main();
