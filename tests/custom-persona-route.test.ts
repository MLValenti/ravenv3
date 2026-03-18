import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const TMP_DIR = path.join(process.cwd(), ".tmp-custom-persona");
const SPEC_FILE = path.join(TMP_DIR, "custom.json");
const PACK_FILE = path.join(TMP_DIR, "custom-pack.json");
const SOURCE_FILE = path.join(TMP_DIR, "Custom Raven.txt");

let routeModulePromise: Promise<typeof import("../app/api/persona/custom/route.ts")> | null = null;

async function getRoute() {
  process.env.RAVEN_CUSTOM_PERSONA_SPEC_FILE = SPEC_FILE;
  process.env.RAVEN_CUSTOM_PERSONA_PACK_FILE = PACK_FILE;
  process.env.RAVEN_CUSTOM_PERSONA_SOURCE_FILE = SOURCE_FILE;
  if (!routeModulePromise) {
    routeModulePromise = import("../app/api/persona/custom/route.ts");
  }
  return routeModulePromise;
}

function buildRequest(payload: Record<string, unknown>) {
  return new Request("http://127.0.0.1:3000/api/persona/custom", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

test("custom persona route persists canonical spec and regenerates local artifacts", async () => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  const route = await getRoute();

  const saveResponse = await route.POST(
    buildRequest({
      name: "Custom Raven",
      directive: "cold and exact",
      avoid: ["No small talk"],
      examples: ["Eyes on me.", "Answer clearly."],
      address_term: "toy",
      intensity: "high",
    }),
  );
  assert.equal(saveResponse.status, 200);
  const saveBody = (await saveResponse.json()) as {
    spec?: { address_term?: string };
    pack?: { examples?: string[] };
  };
  assert.equal(saveBody.spec?.address_term, "toy");
  assert.ok((saveBody.pack?.examples ?? []).length > 0);

  assert.equal(fs.existsSync(SPEC_FILE), true);
  assert.equal(fs.existsSync(PACK_FILE), true);
  assert.equal(fs.existsSync(SOURCE_FILE), true);
  assert.match(fs.readFileSync(SOURCE_FILE, "utf8"), /Eyes on me\./i);

  const getResponse = await route.GET();
  assert.equal(getResponse.status, 200);
  const getBody = (await getResponse.json()) as {
    spec?: { directive?: string };
  };
  assert.equal(getBody.spec?.directive, "cold and exact");

  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});
