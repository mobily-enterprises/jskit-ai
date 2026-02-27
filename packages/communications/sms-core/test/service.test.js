import assert from "node:assert/strict";
import test from "node:test";
import { createService } from "../src/shared/index.js";

test("sms core validates recipient and message", async () => {
  const service = createService({ driver: "none" });
  const invalidRecipient = await service.sendSms({ to: "invalid", text: "hello" });
  const invalidMessage = await service.sendSms({ to: "+15555551234", text: "" });
  const notConfigured = await service.sendSms({ to: "+15555551234", text: "hello" });

  assert.equal(invalidRecipient.reason, "invalid_recipient");
  assert.equal(invalidMessage.reason, "invalid_message");
  assert.equal(notConfigured.reason, "not_configured");
});
