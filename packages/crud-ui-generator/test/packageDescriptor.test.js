import assert from "node:assert/strict";
import test from "node:test";
import descriptor from "../package.descriptor.mjs";

test("crud-ui-generator operations option exposes structured csv-enum metadata", () => {
  assert.equal(descriptor.kind, "generator");
  assert.equal(descriptor.options?.operations?.validationType, "csv-enum");
  assert.deepEqual(
    descriptor.options?.operations?.allowedValues,
    ["list", "view", "new", "edit"]
  );
  assert.equal(descriptor.options?.operations?.defaultValue, "list,view,new,edit");
  assert.equal(descriptor.metadata?.generatorSubcommands?.crud?.optionNames?.includes("operations"), true);
});

test("crud-ui-generator parent-title option exposes structured enum metadata", () => {
  assert.equal(descriptor.options?.["parent-title"]?.validationType, "enum");
  assert.deepEqual(
    descriptor.options?.["parent-title"]?.allowedValues,
    ["contextual", "none"]
  );
  assert.equal(descriptor.options?.["parent-title"]?.defaultValue, "contextual");
  assert.equal(descriptor.metadata?.generatorSubcommands?.crud?.optionNames?.includes("parent-title"), true);
});

test("crud-ui-generator placement scaffold includes an explicit stock icon prop", () => {
  const placementMutation = descriptor?.mutations?.text?.find(
    (entry) => String(entry?.id || "").trim() === "crud-ui-placement-menu"
  );
  assert.match(String(placementMutation?.value || ""), /icon: "__JSKIT_UI_MENU_ICON__"/);
});
