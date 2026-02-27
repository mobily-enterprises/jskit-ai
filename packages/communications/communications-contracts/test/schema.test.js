import assert from "node:assert/strict";
import test from "node:test";
import { schema } from "../src/shared/index.js";

test("communications contracts expose sms/email request and response schemas", () => {
  assert.ok(schema.body.sendSms);
  assert.ok(schema.body.sendEmail);
  assert.ok(schema.response.sendSms);
  assert.ok(schema.response.sendEmail);
});
