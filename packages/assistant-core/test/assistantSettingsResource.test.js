import test from "node:test";
import assert from "node:assert/strict";
import { Check } from "typebox/value";
import { resolveStructuredSchemaTransportSchema } from "@jskit-ai/kernel/shared/validators";
import { validateOperationSectionAsync } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import { assistantConfigResource } from "../src/shared/assistantSettingsResource.js";

test("assistant config resource exposes valid output schema", () => {
  const viewSchema = resolveStructuredSchemaTransportSchema(
    assistantConfigResource.operations.view.output,
    {
      context: "assistant config view output",
      defaultMode: "replace"
    }
  );

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

test("assistant settings patch validation preserves omitted fields", async () => {
  const patch = await validateOperationSectionAsync({
    operation: assistantConfigResource.operations.patch,
    section: "body",
    value: {}
  });

  assert.equal(patch.ok, true);
  assert.deepEqual(patch.value, {});
});
