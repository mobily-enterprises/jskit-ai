import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

function resolveTemplatePath(relativePath) {
  return fileURLToPath(new URL(`../templates/${relativePath}`, import.meta.url));
}

test("actions template does not emit resource action output validators", async () => {
  const actionsTemplate = await readFile(
    resolveTemplatePath("src/local-package/server/actions.js"),
    "utf8"
  );

  assert.match(
    actionsTemplate,
    /output:\s*null,/
  );
  assert.doesNotMatch(
    actionsTemplate,
    /createJsonApiResourceActionOutputValidator/
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

test("shared resource template uses defineCrudResource export", async () => {
  const sharedResourceTemplate = await readFile(
    resolveTemplatePath("src/local-package/shared/crudResource.js"),
    "utf8"
  );

  assert.match(
    sharedResourceTemplate,
    /import\s*\{\s*defineCrudResource\s*\}\s*from\s*"@jskit-ai\/resource-crud-core\/shared\/crudResource";/s
  );
  assert.doesNotMatch(
    sharedResourceTemplate,
    /from\s*"json-rest-schema";/
  );
});
