import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";

const DEV_HOST = "127.0.0.1";
const DEV_PORT = Number(process.env.RAVEN_EVAL_DEV_PORT ?? "3000");
const HEALTH_URL = `http://${DEV_HOST}:${DEV_PORT}/api/health`;
const MAX_HEALTH_WAIT_MS = Number(process.env.RAVEN_EVAL_HEALTH_WAIT_MS ?? "120000");
const HEALTH_POLL_MS = 1000;
const NODE_EXE = "C:\\Progra~1\\nodejs\\node.exe";

function now(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  process.stdout.write(`[${now()}] ${message}\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(url: string, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok) {
        return true;
      }
    } catch {
      // Continue polling.
    }
    await sleep(HEALTH_POLL_MS);
  }
  return false;
}

async function isHealthy(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

function startDevServer(): ChildProcessWithoutNullStreams {
  const child = spawn(
    "C:\\Progra~1\\nodejs\\node.exe",
    [
      "node_modules\\next\\dist\\bin\\next",
      "dev",
      "--hostname",
      DEV_HOST,
      "--port",
      String(DEV_PORT),
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: "pipe",
      windowsHide: true,
    },
  );

  child.stdout.on("data", (chunk: Buffer) => {
    process.stdout.write(`[dev] ${chunk.toString()}`);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    process.stderr.write(`[dev:err] ${chunk.toString()}`);
  });
  child.on("exit", (code, signal) => {
    log(`dev server exited code=${code ?? "null"} signal=${signal ?? "null"}`);
  });

  return child;
}

function stopProcessTree(pid: number): void {
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
}

function runEvalHarness(appChatUrl: string): number {
  const env = {
    ...process.env,
    RAVEN_EVAL_APP_CHAT_URL: appChatUrl,
  };
  const result = spawnSync(
    NODE_EXE,
    ["--experimental-strip-types", "tools/eval/session-llm-harness.ts"],
    {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
      windowsHide: true,
    },
  );
  if (result.error) {
    process.stderr.write(`eval harness spawn error: ${result.error.message}\n`);
  }
  return typeof result.status === "number" ? result.status : 1;
}

async function main(): Promise<void> {
  let dev: ChildProcessWithoutNullStreams | null = null;
  let startedByScript = false;

  const existingHealthy = await isHealthy(HEALTH_URL);
  if (existingHealthy) {
    log(`reusing existing healthy server: ${HEALTH_URL}`);
  } else {
    log(`starting local dev server on ${DEV_HOST}:${DEV_PORT}`);
    dev = startDevServer();
    startedByScript = true;
    const healthy = await waitForHealth(HEALTH_URL, MAX_HEALTH_WAIT_MS);
    if (!healthy) {
      log(`health check did not become ready: ${HEALTH_URL}`);
      if (dev?.pid !== undefined) {
        stopProcessTree(dev.pid);
      }
      process.exitCode = 2;
      return;
    }
    log(`health check ready: ${HEALTH_URL}`);
  }

  const appChatUrl = `http://${DEV_HOST}:${DEV_PORT}/api/chat`;
  const exitCode = runEvalHarness(appChatUrl);
  if (startedByScript && dev?.pid !== undefined) {
    stopProcessTree(dev.pid);
  }
  process.exitCode = exitCode;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
