type LocalBaseUrlValidationResult =
  | { ok: true; normalizedBaseUrl: string }
  | { ok: false; error: string };

function normalizeBaseUrlPath(pathname: string): string {
  if (pathname === "/") {
    return "";
  }

  return pathname.replace(/\/+$/, "");
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function isIPv4Hostname(hostname: string): boolean {
  return /^\d+\.\d+\.\d+\.\d+$/.test(hostname);
}

function validateAndNormalizeLocalBaseUrl(
  rawValue: string,
  protocol: "http:" | "ws:",
  protocolErrorMessage: string,
): LocalBaseUrlValidationResult {
  let parsed: URL;

  try {
    parsed = new URL(rawValue);
  } catch {
    return { ok: false, error: "Base URL is not a valid URL." };
  }

  if (parsed.protocol !== protocol) {
    return { ok: false, error: protocolErrorMessage };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: "Base URL must not include credentials." };
  }

  if (parsed.search || parsed.hash) {
    return { ok: false, error: "Base URL must not include query parameters or a hash fragment." };
  }

  if (!isLoopbackHost(parsed.hostname)) {
    if (isIPv4Hostname(parsed.hostname)) {
      return {
        ok: false,
        error: "Base URL IP is not loopback. Only localhost or 127.0.0.1 are allowed.",
      };
    }

    return { ok: false, error: "Base URL host must be localhost or 127.0.0.1." };
  }

  const normalizedPath = normalizeBaseUrlPath(parsed.pathname);

  return { ok: true, normalizedBaseUrl: `${parsed.origin}${normalizedPath}` };
}

export function validateAndNormalizeLocalHttpBaseUrl(
  rawValue: string,
): LocalBaseUrlValidationResult {
  return validateAndNormalizeLocalBaseUrl(
    rawValue,
    "http:",
    "Base URL must use http:// for local Ollama access.",
  );
}

export function validateAndNormalizeLocalWsBaseUrl(
  rawValue: string,
): LocalBaseUrlValidationResult {
  return validateAndNormalizeLocalBaseUrl(
    rawValue,
    "ws:",
    "Base URL must use ws:// for local Intiface access.",
  );
}
