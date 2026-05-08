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

test("crud-ui-generator navigation-role option exposes product-aware placement metadata", () => {
  assert.equal(descriptor.options?.["navigation-role"]?.validationType, "enum");
  assert.deepEqual(
    descriptor.options?.["navigation-role"]?.allowedValues,
    ["primary", "secondary", "utility", "detail", "workflow", "none"]
  );
  assert.equal(descriptor.options?.["navigation-role"]?.defaultValue, "");
  assert.equal(descriptor.metadata?.generatorSubcommands?.crud?.optionNames?.includes("navigation-role"), true);

  const placementMutation = descriptor?.mutations?.text?.find(
    (entry) => String(entry?.id || "").trim() === "crud-ui-placement-menu"
  );
  assert.deepEqual(placementMutation?.when, {
    option: "operations",
    in: ["list"]
  });
  assert.equal(placementMutation?.value, "__JSKIT_UI_MENU_APPEND_BLOCK__");
});

test("crud-ui-generator placement scaffold is rendered by template context", () => {
  const placementMutation = descriptor?.mutations?.text?.find(
    (entry) => String(entry?.id || "").trim() === "crud-ui-placement-menu"
  );
  assert.equal(placementMutation?.value, "__JSKIT_UI_MENU_APPEND_BLOCK__");
});

test("crud-ui-generator installs page-local list filter definition seam for list pages", () => {
  const filterMutation = descriptor?.mutations?.files?.find(
    (entry) => String(entry?.id || "").trim() === "crud-ui-page-list-filters-${option:target-root|snake}"
  );

  assert.equal(filterMutation?.from, "templates/src/pages/admin/ui-generator/listFilters.js");
  assert.equal(filterMutation?.to, "src/pages/${option:target-root|trim}/listFilters.js");
  assert.deepEqual(filterMutation?.when, {
    option: "operations",
    in: ["list"]
  });
});

test("crud-ui-generator installs page-local list bulk action definition seam for list pages", () => {
  const bulkActionMutation = descriptor?.mutations?.files?.find(
    (entry) => String(entry?.id || "").trim() === "crud-ui-page-list-bulk-actions-${option:target-root|snake}"
  );

  assert.equal(bulkActionMutation?.from, "templates/src/pages/admin/ui-generator/listBulkActions.js");
  assert.equal(bulkActionMutation?.to, "src/pages/${option:target-root|trim}/listBulkActions.js");
  assert.deepEqual(bulkActionMutation?.when, {
    option: "operations",
    in: ["list"]
  });
});
