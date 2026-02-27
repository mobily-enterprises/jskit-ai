import assert from "node:assert/strict";
import test from "node:test";

import {
  createDiagnostic,
  createDiagnosticsCollector,
  throwOnDiagnosticErrors,
  DIAGNOSTIC_LEVELS
} from "../src/shared/diagnostics.js";

test("createDiagnostic normalizes required fields and defaults level", () => {
  const diagnostic = createDiagnostic({
    code: "TEST_CODE",
    message: "Something happened"
  });

  assert.equal(diagnostic.code, "TEST_CODE");
  assert.equal(diagnostic.level, DIAGNOSTIC_LEVELS.error);
  assert.equal(diagnostic.message, "Something happened");
  assert.ok(Object.isFrozen(diagnostic));
});

test("collector records diagnostics and exposes hasErrors", () => {
  const collector = createDiagnosticsCollector();
  collector.add({
    code: "WARN_A",
    level: "warn",
    message: "warn"
  });
  collector.add({
    code: "ERR_A",
    message: "error"
  });

  assert.equal(collector.toJSON().length, 2);
  assert.equal(collector.hasErrors(), true);
});

test("throwOnDiagnosticErrors throws with diagnostics payload", () => {
  const collector = createDiagnosticsCollector();
  collector.add({
    code: "ERR_A",
    message: "error"
  });

  assert.throws(
    () => throwOnDiagnosticErrors(collector, "failure"),
    (error) =>
      error?.code === "MODULE_FRAMEWORK_DIAGNOSTIC_ERROR" &&
      error?.message === "failure" &&
      Array.isArray(error?.diagnostics)
  );
});
