import assert from "node:assert/strict";
import test from "node:test";
import descriptor from "../package.descriptor.mjs";

test("crud-server-generator surface option validates against enabled surface ids", () => {
  assert.equal(descriptor.kind, "generator");
  assert.equal(descriptor.options?.surface?.validationType, "enabled-surface-id");
  assert.equal(descriptor.metadata?.generatorSubcommands?.scaffold?.optionNames?.includes("surface"), true);
  assert.equal(descriptor.metadata?.generatorSubcommands?.scaffold?.optionNames?.includes("force"), true);
  assert.equal(descriptor.metadata?.generatorSubcommands?.scaffold?.createTarget?.pathTemplate, "packages/${option:namespace|kebab}");
});

test("crud-server-generator installs listConfig alongside server templates", () => {
  const files = descriptor.mutations?.files || [];
  const listConfigTemplate = files.find((entry) => entry.from === "templates/src/local-package/server/listConfig.js");

  assert.ok(listConfigTemplate);
  assert.equal(
    listConfigTemplate.to,
    "packages/${option:namespace|kebab}/src/server/listConfig.js"
  );
  assert.deepEqual(listConfigTemplate.templateContext, {
    entrypoint: "src/server/buildTemplateContext.js",
    export: "buildTemplateContext"
  });
});

test("crud-server-generator wires action and role mutations through template context", () => {
  const files = descriptor.mutations?.files || [];
  const actionsTemplate = files.find((entry) => entry.from === "templates/src/local-package/server/actions.js");
  const roleGrantMutation = (descriptor.mutations?.text || []).find((entry) => entry.file === "config/roles.js");

  assert.ok(actionsTemplate);
  assert.deepEqual(actionsTemplate.templateContext, {
    entrypoint: "src/server/buildTemplateContext.js",
    export: "buildTemplateContext"
  });

  assert.ok(roleGrantMutation);
  assert.equal(roleGrantMutation.value, "__JSKIT_CRUD_ROLE_CATALOG_PERMISSION_GRANTS__");
  assert.deepEqual(roleGrantMutation.templateContext, {
    entrypoint: "src/server/buildTemplateContext.js",
    export: "buildTemplateContext"
  });
});
