import test from "node:test";
import assert from "node:assert/strict";
import { Check } from "typebox/value";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import { assistantConfigResource } from "../src/shared/assistantSettingsResource.js";

test("assistant config resource exposes valid output schema", () => {
  const viewSchema = assistantConfigResource.operations.view.outputValidator.schema;

  assert.equal(
    Check(viewSchema, {
      targetSurfaceId: "app",
      scopeKey: "app:global",
      workspaceId: null,
      settings: {
        systemPrompt: ""
      }
    }),
    true
  );
});

test("assistant settings patch normalizer preserves omitted fields", () => {
  const patch = validateOperationSection({
    operation: assistantConfigResource.operations.patch,
    section: "bodyValidator",
    value: {}
  });

  assert.equal(patch.ok, true);
  assert.deepEqual(patch.value, {});
});
