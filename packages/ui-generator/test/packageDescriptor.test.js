import assert from "node:assert/strict";
import test from "node:test";
import descriptor from "../package.descriptor.mjs";

test("ui-generator surface options validate against enabled surface ids", () => {
  assert.equal(descriptor.kind, "generator");
  assert.equal(descriptor.options?.surface?.validationType, "enabled-surface-id");
  assert.equal(descriptor.metadata?.generatorSubcommands?.["placed-element"]?.optionNames?.includes("surface"), true);
  assert.equal(descriptor.metadata?.generatorSubcommands?.["placed-element"]?.requiredOptionNames?.includes("surface"), false);
  assert.equal(descriptor.metadata?.generatorSubcommands?.page?.optionNames?.includes("force"), true);
});
