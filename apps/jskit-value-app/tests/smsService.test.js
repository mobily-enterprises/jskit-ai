import assert from "node:assert/strict";
import test from "node:test";

import { createService as createSmsService, __testables } from "../server/domain/communications/services/sms.service.js";

test("sms service validates supported drivers", () => {
  assert.throws(() => createSmsService({ driver: "twilio" }), /Unsupported SMS_DRIVER/);
  assert.equal(__testables.normalizeDriver("none"), "none");
  assert.equal(__testables.normalizeDriver("plivo"), "plivo");
});

test("sms service returns validation and not-configured states", async () => {
  const service = createSmsService({
    driver: "none"
  });

  const invalidRecipient = await service.sendSms({
    to: "5551234",
    text: "hello"
  });
  assert.deepEqual(invalidRecipient, {
    sent: false,
    reason: "invalid_recipient",
    provider: "none",
    messageId: null
  });

  const invalidMessage = await service.sendSms({
    to: "+15551234567",
    text: ""
  });
  assert.deepEqual(invalidMessage, {
    sent: false,
    reason: "invalid_message",
    provider: "none",
    messageId: null
  });

  const notConfigured = await service.sendSms({
    to: "+15551234567",
    text: "hello"
  });
  assert.deepEqual(notConfigured, {
    sent: false,
    reason: "not_configured",
    provider: "none",
    messageId: null
  });
});

test("sms service returns not-implemented when plivo config is present", async () => {
  const service = createSmsService({
    driver: "plivo",
    plivoAuthId: "id",
    plivoAuthToken: "token",
    plivoSourceNumber: "+15557654321"
  });

  const result = await service.sendSms({
    to: "+15551234567",
    text: "hello"
  });
  assert.deepEqual(result, {
    sent: false,
    reason: "not_implemented",
    provider: "plivo",
    messageId: null
  });
});

test("sms service marks plivo as not configured when credentials are incomplete", async () => {
  const service = createSmsService({
    driver: "plivo",
    plivoAuthId: "",
    plivoAuthToken: "",
    plivoSourceNumber: ""
  });

  const result = await service.sendSms({
    to: "+15551234567",
    text: "hello"
  });
  assert.deepEqual(result, {
    sent: false,
    reason: "not_configured",
    provider: "plivo",
    messageId: null
  });
});
