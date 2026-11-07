import test from "node:test";
import assert from "node:assert/strict";
import { resolveSchemaTransportSchemaDefinition } from "@jskit-ai/kernel/shared/validators";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import { assistantConfigContract } from "../src/shared/assistantSettingsResource.js";

test("assistant config resource exposes valid output schema", () => {
  const viewSchema = resolveSchemaTransportSchemaDefinition(
    assistantConfigContract.operations.view.output,
    {
      context: "assistant config view output",
      defaultMode: "replace"
    }
  );

  assert.equal(viewSchema.type, "object");
  assert.equal(viewSchema.additionalProperties, false);
  assert.equal(viewSchema.properties.targetSurfaceId.type, "string");
  assert.equal(viewSchema.properties.settings["x-json-rest-schema"]?.castType, "object");
  assert.equal(Array.isArray(viewSchema.properties.settings.allOf), true);
  assert.match(viewSchema.properties.settings.allOf[0]?.$ref || "", /^#\/definitions\//);
});

test("assistant settings patch validation preserves omitted fields", async () => {
  const patch = await validateOperationSection({
    operation: assistantConfigContract.operations.patch,
    section: "body",
    value: {}
  });

  assert.equal(patch.ok, true);
  assert.deepEqual(patch.value, {});
});
