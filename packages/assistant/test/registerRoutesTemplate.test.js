import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const packageRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

test("assistant registerRoutes template composes workspace params with route-specific params", async () => {
  const source = await readFile(path.join(packageRoot, "templates/src/local-package/server/registerRoutes.js"), "utf8");

  assert.match(source, /const baseParamsValidator = baseConfig\?\.\s*paramsValidator;/);
  assert.match(
    source,
    /const paramsValidator = baseParamsValidator\s*\?\s*\[workspaceSlugParamsValidator\]\.concat\(baseParamsValidator\)\s*:\s*workspaceSlugParamsValidator;/
  );
  assert.match(
    source,
    /paramsValidator:\s*assistantResource\.operations\.conversationMessagesList\.paramsValidator,/
  );
  assert.doesNotMatch(
    source,
    /paramsValidator:\s*assistantRuntimeConfig\.runtimeSurfaceRequiresWorkspace\s*\?\s*\[workspaceSlugParamsValidator,\s*assistantResource\.operations\.conversationMessagesList\.paramsValidator\]/
  );
});
