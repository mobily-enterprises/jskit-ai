import test from "node:test";
import assert from "node:assert/strict";
import { Check } from "typebox/value";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import {
  assistantConsoleSettingsResource,
  assistantWorkspaceSettingsResource
} from "../src/shared/assistantSettingsResource.js";

test("assistant settings resources expose valid output schemas", () => {
  const consoleSchema = assistantConsoleSettingsResource.operations.view.outputValidator.schema;
  const workspaceSchema = assistantWorkspaceSettingsResource.operations.view.outputValidator.schema;

  assert.equal(
    Check(consoleSchema, {
      settings: {
        workspaceSurfacePrompt: ""
      }
    }),
    true
  );
  assert.equal(
    Check(workspaceSchema, {
      settings: {
        appSurfacePrompt: ""
      }
    }),
    true
  );
});

test("assistant settings patch normalizer preserves omitted fields", () => {
  const consolePatch = validateOperationSection({
    operation: assistantConsoleSettingsResource.operations.patch,
    section: "bodyValidator",
    value: {}
  });
  const workspacePatch = validateOperationSection({
    operation: assistantWorkspaceSettingsResource.operations.patch,
    section: "bodyValidator",
    value: {}
  });

  assert.equal(consolePatch.ok, true);
  assert.equal(workspacePatch.ok, true);
  assert.deepEqual(consolePatch.value, {});
  assert.deepEqual(workspacePatch.value, {});
});
