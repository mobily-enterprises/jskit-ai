import assert from "node:assert/strict";
import test from "node:test";
import { createService } from "../src/lib/index.js";

test("email core defaults to not implemented provider", async () => {
  const service = createService();
  const result = await service.sendEmail({ to: "a@example.com", subject: "hello" });
  assert.equal(result.sent, false);
  assert.equal(result.reason, "not_implemented");
});
