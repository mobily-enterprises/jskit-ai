import test from "node:test";
import assert from "node:assert/strict";
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

  assert.equal(viewSchema.type, "object");
  assert.equal(viewSchema.additionalProperties, false);
  assert.equal(viewSchema.properties.targetSurfaceId.type, "string");
  assert.equal(viewSchema.properties.settings.type, "object");
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
