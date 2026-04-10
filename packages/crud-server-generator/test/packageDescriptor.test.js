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
