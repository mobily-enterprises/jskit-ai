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
