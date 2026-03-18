import test from "node:test";
import assert from "node:assert/strict";

import {
  validateAndNormalizeLocalHttpBaseUrl,
  validateAndNormalizeLocalWsBaseUrl,
} from "../lib/local-url.ts";

test("allows localhost and normalizes trailing slash", () => {
  const result = validateAndNormalizeLocalHttpBaseUrl("http://localhost:11434/");

  assert.equal(result.ok, true);
  assert.equal(
    result.ok ? result.normalizedBaseUrl : "invalid",
    "http://localhost:11434",
  );
});

test("allows 127.0.0.1", () => {
  const result = validateAndNormalizeLocalHttpBaseUrl("http://127.0.0.1:11434");

  assert.equal(result.ok, true);
  assert.equal(
    result.ok ? result.normalizedBaseUrl : "invalid",
    "http://127.0.0.1:11434",
  );
});

test("rejects non-loopback IP", () => {
  const result = validateAndNormalizeLocalHttpBaseUrl("http://192.168.1.5:11434");

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /not loopback/i);
});

test("rejects non-localhost hostname", () => {
  const result = validateAndNormalizeLocalHttpBaseUrl("http://example.com:11434");

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /localhost|127\.0\.0\.1/i);
});

test("allows local ws URL for Intiface", () => {
  const result = validateAndNormalizeLocalWsBaseUrl("ws://localhost:12345/");
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.normalizedBaseUrl : "", "ws://localhost:12345");
});

test("rejects non-ws protocol for Intiface URL", () => {
  const result = validateAndNormalizeLocalWsBaseUrl("http://localhost:12345");
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /ws/i);
});
