import assert from "node:assert/strict";
import test from "node:test";
import packageJson from "../package.json" with { type: "json" };

const packageMetadata = packageJson.jskit;

test("crud-ui-generator operations option exposes structured csv-enum metadata", () => {
  assert.equal(packageMetadata.kind, "generator");
  assert.equal(packageMetadata.options?.operations?.validationType, "csv-enum");
  assert.deepEqual(
    packageMetadata.options?.operations?.allowedValues,
    ["list", "view", "new", "edit"]
  );
  assert.equal(packageMetadata.options?.operations?.defaultValue, "list,view,new,edit");
  assert.equal(packageMetadata.metadata?.generatorSubcommands?.crud?.optionNames?.includes("operations"), true);
});

test("crud-ui-generator parent-title option exposes structured enum metadata", () => {
  assert.equal(packageMetadata.options?.["parent-title"]?.validationType, "enum");
  assert.deepEqual(
    packageMetadata.options?.["parent-title"]?.allowedValues,
    ["contextual", "none"]
  );
  assert.equal(packageMetadata.options?.["parent-title"]?.defaultValue, "contextual");
  assert.equal(packageMetadata.metadata?.generatorSubcommands?.crud?.optionNames?.includes("parent-title"), true);
});

test("crud-ui-generator exposes opt-in delete confirmation in detailed help", () => {
  assert.equal(packageMetadata.options?.["delete-confirmation"]?.inputType, "flag");
  assert.equal(packageMetadata.options?.["delete-confirmation"]?.defaultValue, "");
  assert.equal(
    packageMetadata.metadata?.generatorSubcommands?.crud?.optionNames?.includes("delete-confirmation"),
    true
  );
  assert.equal(
    packageMetadata.metadata?.generatorSubcommands?.crud?.examples?.some((example) =>
      example.lines?.some((line) => line.includes("--delete-confirmation"))
    ),
    true
  );
});

test("crud-ui-generator navigation-role option exposes product-aware placement metadata", () => {
  assert.equal(packageMetadata.options?.["navigation-role"]?.validationType, "enum");
  assert.deepEqual(
    packageMetadata.options?.["navigation-role"]?.allowedValues,
    ["primary", "secondary", "utility", "detail", "workflow", "none"]
  );
  assert.equal(packageMetadata.options?.["navigation-role"]?.defaultValue, "");
  assert.equal(packageMetadata.metadata?.generatorSubcommands?.crud?.optionNames?.includes("navigation-role"), true);

  const placementMutation = packageMetadata?.mutations?.text?.find(
    (entry) => String(entry?.id || "").trim() === "crud-ui-placement-menu"
  );
  assert.deepEqual(placementMutation?.when, {
    option: "operations",
    in: ["list"]
  });
  assert.equal(placementMutation?.value, "__JSKIT_UI_MENU_APPEND_BLOCK__");
});

test("crud-ui-generator placement scaffold is rendered by template context", () => {
  const placementMutation = packageMetadata?.mutations?.text?.find(
    (entry) => String(entry?.id || "").trim() === "crud-ui-placement-menu"
  );
  assert.equal(placementMutation?.value, "__JSKIT_UI_MENU_APPEND_BLOCK__");
});

test("crud-ui-generator installs page-local list filter definition seam for list pages", () => {
  const filterMutation = packageMetadata?.mutations?.files?.find(
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
  const bulkActionMutation = packageMetadata?.mutations?.files?.find(
    (entry) => String(entry?.id || "").trim() === "crud-ui-page-list-bulk-actions-${option:target-root|snake}"
  );

  assert.equal(bulkActionMutation?.from, "templates/src/pages/admin/ui-generator/listBulkActions.js");
  assert.equal(bulkActionMutation?.to, "src/pages/${option:target-root|trim}/listBulkActions.js");
  assert.deepEqual(bulkActionMutation?.when, {
    option: "operations",
    in: ["list"]
  });
});

test("crud-ui-generator installs shared form helpers outside the file-router pages root", () => {
  const componentMutation = packageMetadata?.mutations?.files?.find(
    (entry) => String(entry?.id || "").startsWith("crud-ui-page-add-edit-form-")
      && entry?.from?.endsWith("/AddEditForm.vue")
  );
  const fieldsMutation = packageMetadata?.mutations?.files?.find(
    (entry) => String(entry?.id || "").startsWith("crud-ui-page-add-edit-form-fields-")
  );

  assert.equal(componentMutation?.to, "src/components/${option:target-root|trim}/CrudAddEditForm.vue");
  assert.equal(fieldsMutation?.to, "src/components/${option:target-root|trim}/CrudAddEditFormFields.js");
  assert.equal(componentMutation?.to?.startsWith("src/pages/"), false);
  assert.equal(fieldsMutation?.to?.startsWith("src/pages/"), false);
});
