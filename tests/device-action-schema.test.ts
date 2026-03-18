import assert from "node:assert/strict";
import test from "node:test";

import {
  extractJsonCandidateFromAssistantText,
  parseDeviceCommandFromAssistantText,
} from "../lib/devices/action-schema.ts";
import {
  formatDeviceActionForDisplay,
  stripActionJsonBlock,
} from "../lib/session/action-request.ts";

test("extracts json action from fenced code block", () => {
  const text = [
    "Keep your posture steady.",
    "```json",
    '{ "type":"device_command","device_id":"0","command":"vibrate","params":{"intensity":0.3,"duration_ms":1500} }',
    "```",
  ].join("\n");

  const json = extractJsonCandidateFromAssistantText(text);
  assert.ok(json);
  assert.match(json ?? "", /\"device_command\"/);
});

test("parses stop_all command without device_id", () => {
  const text = [
    "Stopping all active output now.",
    "```json",
    '{ "type":"device_command","command":"stop_all","params":{} }',
    "```",
  ].join("\n");

  const parsed = parseDeviceCommandFromAssistantText(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.ok ? parsed.request.command : "", "stop_all");
});

test("rejects invalid action command", () => {
  const text = [
    "```json",
    '{ "type":"device_command","device_id":"0","command":"blink","params":{} }',
    "```",
  ].join("\n");
  const parsed = parseDeviceCommandFromAssistantText(text);
  assert.equal(parsed.ok, false);
});

test("parses inline action json appended to conversational text", () => {
  const text =
    'You are all mine for the night. { "type":"device_command","device_id":"0","command":"vibrate","params":{"intensity":0.3,"duration_ms":1500} }';
  const parsed = parseDeviceCommandFromAssistantText(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.ok ? parsed.request.command : "", "vibrate");
  assert.equal(parsed.ok ? parsed.request.device_id : "", "0");
});

test("strips inline action json from assistant display text", () => {
  const text =
    'Focus on me now. { "type":"device_command","device_id":"0","command":"vibrate","params":{"intensity":0.3,"duration_ms":1500} }';
  const stripped = stripActionJsonBlock(text);
  assert.equal(stripped, "Focus on me now.");
});

test("parses plain text device command when JSON is missing", () => {
  const text =
    "You've confirmed your eagerness to please me. Device 0, vibrate for 3 seconds. Your face is still slightly averted.";
  const parsed = parseDeviceCommandFromAssistantText(text);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.request.command, "vibrate");
    assert.equal(parsed.request.device_id, "0");
    assert.equal(parsed.request.params?.duration_ms, 3000);
  }
});

test("strips orphan json fence label from assistant text", () => {
  const text = "It's nice to see you again, darling. json";
  const stripped = stripActionJsonBlock(text);
  assert.equal(stripped, "It's nice to see you again, darling.");
});

test("parses malformed json-like payload with single quotes", () => {
  const text =
    "Use this now { 'type':'device_command','device_id':'0','command':'vibrate','params':{'intensity':0.3,'duration_ms':1500} }";
  const parsed = parseDeviceCommandFromAssistantText(text);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.request.command, "vibrate");
    assert.equal(parsed.request.device_id, "0");
    assert.equal(parsed.request.params?.intensity, 0.3);
    assert.equal(parsed.request.params?.duration_ms, 1500);
  }
});

test("formats parsed action for display without requiring raw json", () => {
  const parsed = parseDeviceCommandFromAssistantText(
    '{ "type":"device_command","device_id":"0","command":"vibrate","params":{"intensity":0.3,"duration_ms":1500} }',
  );
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    const line = formatDeviceActionForDisplay(parsed.request);
    assert.match(line, /Device command: vibrate device 0/i);
    assert.match(line, /intensity 0\.30/i);
    assert.match(line, /duration 1500ms/i);
  }
});
