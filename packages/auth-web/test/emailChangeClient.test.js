import assert from "node:assert/strict";
import test from "node:test";
import { confirmEmailChangeLink } from "../src/client/runtime/emailChangeLink.js";

test("an email change page confirms the link it was opened with, once; a page without one asks nothing", async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push([url, options]);
    return { ok: true, email: "new@example.com" };
  };
  assert.deepEqual(await confirmEmailChangeLink("https://app.example/auth/email-change?token=link-token", request),
    { status: "done", email: "new@example.com", error: null });
  assert.deepEqual(calls, [["/api/email-change/confirm", { method: "POST", body: { token: "link-token" } }]]);

  assert.deepEqual(await confirmEmailChangeLink("https://app.example/auth/email-change", request),
    { status: "missing", email: "", error: null });
  assert.deepEqual(await confirmEmailChangeLink("not an address", request), { status: "missing", email: "", error: null });
  assert.equal(calls.length, 1);

  const refused = Object.assign(new Error("This email change link is invalid, used or expired. Ask for the change again."), {
    status: 400,
    code: "auth.local.emailChange.linkInvalid"
  });
  const failed = await confirmEmailChangeLink("https://app.example/auth/email-change?token=used", async () => {
    throw refused;
  });
  assert.deepEqual(failed, { status: "error", email: "", error: refused });
});
