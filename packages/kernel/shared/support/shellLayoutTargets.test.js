import assert from "node:assert/strict";
import test from "node:test";
import { normalizeShellOutletTargetId } from "./shellLayoutTargets.js";

test("normalizeShellOutletTargetId validates host:position tokens", () => {
  assert.equal(normalizeShellOutletTargetId("shell-layout:primary-menu"), "shell-layout:primary-menu");
  assert.equal(normalizeShellOutletTargetId(" shell-layout : primary-menu "), "shell-layout:primary-menu");
  assert.equal(normalizeShellOutletTargetId(""), "");
  assert.equal(normalizeShellOutletTargetId("shell-layout"), "");
  assert.equal(normalizeShellOutletTargetId("shell-layout:"), "");
});
