import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

function resolveTemplatePath(relativePath) {
  return fileURLToPath(new URL(`../templates/${relativePath}`, import.meta.url));
}

test("actions template uses resource symbol for view output validator", async () => {
  const actionsTemplate = await readFile(
    resolveTemplatePath("src/local-package/server/actions.js"),
    "utf8"
  );

  assert.match(
    actionsTemplate,
    /output:\s*resource\.operations\.view\.output,/
  );
  assert.doesNotMatch(
    actionsTemplate,
    /\$\{option:namespace\|singular\|camel\}Resource\.operations\.view\.output/
  );
});

test("shared index template re-exports standardized resource symbol", async () => {
  const sharedIndexTemplate = await readFile(
    resolveTemplatePath("src/local-package/shared/index.js"),
    "utf8"
  );

  assert.match(
    sharedIndexTemplate,
    /export\s*\{\s*resource\s*\}\s*from\s*"\.\/\$\{option:namespace\|singular\|camel\}Resource\.js";/s
  );
  assert.doesNotMatch(
    sharedIndexTemplate,
    /export\s*\{\s*\$\{option:namespace\|singular\|camel\}Resource\s*\}/s
  );
});

test("shared resource template uses kernel createSchema export", async () => {
  const sharedResourceTemplate = await readFile(
    resolveTemplatePath("src/local-package/shared/crudResource.js"),
    "utf8"
  );

  assert.match(
    sharedResourceTemplate,
    /import\s*\{\s*createSchema,\s*createCursorListValidator,\s*RECORD_ID_PATTERN\s*\}\s*from\s*"@jskit-ai\/kernel\/shared\/validators";/s
  );
  assert.doesNotMatch(
    sharedResourceTemplate,
    /from\s*"json-rest-schema";/
  );
});
