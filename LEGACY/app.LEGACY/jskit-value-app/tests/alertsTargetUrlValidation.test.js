import assert from "node:assert/strict";
import test from "node:test";

import { evaluateAlertTargetUrl, normalizeAlertTargetUrl } from "../shared/alerts/targetUrl.js";

test("evaluateAlertTargetUrl enforces required in-app path rules", () => {
  assert.deepEqual(evaluateAlertTargetUrl(""), {
    targetUrl: "",
    error: "targetUrl is required."
  });

  assert.deepEqual(evaluateAlertTargetUrl(" https://example.com "), {
    targetUrl: "https://example.com",
    error: "targetUrl must start with /."
  });

  assert.deepEqual(evaluateAlertTargetUrl("//example.com"), {
    targetUrl: "//example.com",
    error: "targetUrl must be an in-app path."
  });

  assert.deepEqual(evaluateAlertTargetUrl("/workspaces"), {
    targetUrl: "/workspaces",
    error: null
  });
});

test("normalizeAlertTargetUrl returns empty string when targetUrl is invalid", () => {
  assert.equal(normalizeAlertTargetUrl(" "), "");
  assert.equal(normalizeAlertTargetUrl("https://example.com"), "");
  assert.equal(normalizeAlertTargetUrl("//example.com"), "");
  assert.equal(normalizeAlertTargetUrl(" /console/invitations "), "/console/invitations");
});
