import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMUNICATION_CHANNELS,
  COMMUNICATION_PROVIDER_RESULT_REASONS,
  normalizeChannel,
  assertDispatchProvider
} from "../src/index.js";

test("communications provider core normalizes channels and validates providers", async () => {
  assert.equal(COMMUNICATION_CHANNELS.SMS, "sms");
  assert.ok(COMMUNICATION_PROVIDER_RESULT_REASONS.includes("not_implemented"));
  assert.equal(normalizeChannel(" SMS "), "sms");

  const provider = assertDispatchProvider({ channel: "sms", async dispatch() {} });
  assert.equal(provider.channel, "sms");

  await assert.rejects(async () => assertDispatchProvider({}), /channel is required/);
});
