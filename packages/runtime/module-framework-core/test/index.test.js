import assert from "node:assert/strict";
import test from "node:test";

import * as framework from "../src/index.js";

test("index exports expected top-level APIs", () => {
  assert.equal(typeof framework.defineModule, "function");
  assert.equal(typeof framework.resolveDependencyGraph, "function");
  assert.equal(typeof framework.resolveCapabilityGraph, "function");
  assert.equal(typeof framework.resolveMounts, "function");
  assert.equal(typeof framework.resolveConflicts, "function");
  assert.equal(typeof framework.composeServerModules, "function");
  assert.equal(typeof framework.composeClientModules, "function");
});
