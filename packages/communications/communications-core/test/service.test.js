import assert from "node:assert/strict";
import test from "node:test";
import { createService } from "../src/shared/index.js";

test("communications core dispatches sms/email through configured services", async () => {
  const calls = [];
  const service = createService({
    smsService: {
      async sendSms(payload) {
        calls.push({ kind: "sms", payload });
        return { sent: true, provider: "none", messageId: "sms-1" };
      }
    },
    emailService: {
      async sendEmail(payload) {
        calls.push({ kind: "email", payload });
        return { sent: true, provider: "none", messageId: "email-1" };
      }
    }
  });

  const sms = await service.sendSms({ to: "+15555551234", text: "hello" });
  const email = await service.sendEmail({ to: "hello@example.com", subject: "Hi" });

  assert.equal(sms.sent, true);
  assert.equal(email.sent, true);
  assert.equal(calls.length, 2);
});
