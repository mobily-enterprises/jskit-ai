import assert from "node:assert/strict";
import test from "node:test";
import descriptor from "../package.descriptor.mjs";

test("crud-server-generator surface option validates against enabled surface ids", () => {
  assert.equal(descriptor.kind, "generator");
  assert.equal(descriptor.options?.surface?.validationType, "enabled-surface-id");
  assert.equal(descriptor.options?.surface?.required, false);
  assert.equal(descriptor.options?.["ownership-filter"]?.validationType, "enum");
  assert.deepEqual(
    descriptor.options?.["ownership-filter"]?.allowedValues,
    ["auto", "public", "user", "workspace", "workspace_user"]
  );
  assert.equal(descriptor.options?.["table-name"]?.required, false);
  assert.equal(
    descriptor.options?.["table-name"]?.defaultFromOptionTemplate,
    "${option:namespace}"
  );
  assert.equal(descriptor.options?.internal?.inputType, "flag");
  assert.equal(descriptor.metadata?.generatorSubcommands?.scaffold?.optionNames?.includes("surface"), true);
  assert.equal(descriptor.metadata?.generatorSubcommands?.scaffold?.optionNames?.includes("force"), true);
  assert.equal(descriptor.metadata?.generatorSubcommands?.scaffold?.optionNames?.includes("internal"), true);
  assert.equal(descriptor.metadata?.generatorSubcommands?.scaffold?.createTarget?.pathTemplate, "packages/${option:namespace|kebab}");
});

test("crud-server-generator no longer installs a separate jsonRestResource server template", () => {
  const files = descriptor.mutations?.files || [];
  const jsonRestResourceTemplate = files.find((entry) => entry.from === "templates/src/local-package/server/jsonRestResource.js");

  assert.equal(jsonRestResourceTemplate, undefined);
});

test("crud-server-generator wires action and role mutations through template context", () => {
  const files = descriptor.mutations?.files || [];
  const descriptorTemplate = files.find((entry) => entry.from === "templates/src/local-package/package.descriptor.mjs");
  const actionsTemplate = files.find((entry) => entry.from === "templates/src/local-package/server/actions.js");
  const routesTemplate = files.find((entry) => entry.from === "templates/src/local-package/server/registerRoutes.js");
  const roleGrantMutation = (descriptor.mutations?.text || []).find((entry) => entry.file === "config/roles.js");

  assert.ok(descriptorTemplate);
  assert.deepEqual(descriptorTemplate.templateContext, {
    entrypoint: "src/server/buildTemplateContext.js",
    export: "buildTemplateContext"
  });

  assert.ok(actionsTemplate);
  assert.deepEqual(actionsTemplate.templateContext, {
    entrypoint: "src/server/buildTemplateContext.js",
    export: "buildTemplateContext"
  });

  assert.ok(routesTemplate);
  assert.deepEqual(routesTemplate.templateContext, {
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
