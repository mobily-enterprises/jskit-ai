import assert from "node:assert/strict";
import test from "node:test";

import { normalizeActionInput } from "../src/lib/policies.js";

test("function schema returns normalized value when ok", async () => {
  const definition = {
    id: "tests.ok",
    version: 1,
    inputSchema: () => ({
      ok: true,
      value: {
        normalized: true
      }
    })
  };

  const result = await normalizeActionInput(definition, { raw: true }, {});
  assert.deepEqual(result, { normalized: true });
});

test("function schema rejects non-contract results", async () => {
  const definition = {
    id: "tests.invalid",
    version: 1,
    inputSchema: () => false
  };

  await assert.rejects(
    () => normalizeActionInput(definition, { raw: true }, {}),
    (error) => {
      assert.equal(error.code, "ACTION_VALIDATION_FAILED");
      assert.match(error.details?.error || "", /Schema validator must return/);
      return true;
    }
  );
});

test("function schema propagates validation errors", async () => {
  const definition = {
    id: "tests.errors",
    version: 2,
    inputSchema: () => ({
      ok: false,
      errors: {
        input: "input is required"
      }
    })
  };

  await assert.rejects(
    () => normalizeActionInput(definition, null, {}),
    (error) => {
      assert.equal(error.code, "ACTION_VALIDATION_FAILED");
      assert.deepEqual(error.details?.fieldErrors, {
        input: "input is required"
      });
      return true;
    }
  );
});
