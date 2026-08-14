import assert from "node:assert/strict";
import test from "node:test";
import packageJson from "../package.json" with { type: "json" };

const packageMetadata = packageJson.jskit;

test("ui-generator surface options validate against enabled surface ids", () => {
  assert.equal(packageMetadata.kind, "generator");
  assert.equal(packageMetadata.options?.surface?.validationType, "enabled-surface-id");
  assert.equal(packageMetadata.metadata?.generatorSubcommands?.["placed-element"]?.optionNames?.includes("surface"), true);
  assert.equal(packageMetadata.metadata?.generatorSubcommands?.["placed-element"]?.requiredOptionNames?.includes("surface"), false);
  assert.equal(packageMetadata.metadata?.generatorSubcommands?.page?.optionNames?.includes("force"), true);
  assert.equal(packageMetadata.options?.kind?.validationType, "enum");
  assert.equal(packageMetadata.options?.["navigation-role"]?.validationType, "enum");
  assert.deepEqual(
    packageMetadata.options?.["navigation-role"]?.allowedValues,
    ["primary", "secondary", "utility", "detail", "workflow", "none"]
  );
  assert.equal(packageMetadata.metadata?.generatorSubcommands?.page?.optionNames?.includes("navigation-role"), true);
  assert.equal(packageMetadata.metadata?.generatorSubcommands?.outlet?.requiredOptionNames?.includes("placement"), false);
  assert.equal(packageMetadata.metadata?.generatorSubcommands?.topology?.entrypoint, "src/server/subcommands/outlet.js");
  assert.equal(packageMetadata.metadata?.generatorSubcommands?.topology?.optionNames?.includes("compact-target"), true);
  assert.equal(packageMetadata.metadata?.generatorSubcommands?.topology?.requiredOptionNames?.includes("kind"), true);
});
