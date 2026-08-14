import assert from "node:assert/strict";
import test from "node:test";
import packageJson from "../package.json" with { type: "json" };

const packageMetadata = packageJson.jskit;

test("crud-server-generator surface option validates against enabled surface ids", () => {
  assert.equal(packageMetadata.kind, "generator");
  assert.equal(packageMetadata.options?.surface?.validationType, "enabled-surface-id");
  assert.equal(packageMetadata.options?.surface?.required, false);
  assert.equal(packageMetadata.options?.["ownership-filter"]?.validationType, "enum");
  assert.deepEqual(
    packageMetadata.options?.["ownership-filter"]?.allowedValues,
    ["auto", "public", "user", "workspace", "workspace_user"]
  );
  assert.equal(packageMetadata.options?.access?.validationType, "enum");
  assert.equal(packageMetadata.options?.access?.defaultValue, "authenticated");
  assert.deepEqual(packageMetadata.options?.access?.allowedValues, ["authenticated", "public"]);
  assert.equal(packageMetadata.options?.["table-name"]?.required, false);
  assert.equal(
    packageMetadata.options?.["table-name"]?.defaultFromOptionTemplate,
    "${option:namespace}"
  );
  assert.equal(packageMetadata.options?.internal?.inputType, "flag");
  assert.equal(packageMetadata.options?.["grant-role"]?.inputType, "text");
  assert.match(packageMetadata.options?.["grant-role"]?.promptHint || "", /choose this or --no-role-grant/);
  assert.equal(packageMetadata.options?.["no-role-grant"]?.inputType, "flag");
  assert.equal(packageMetadata.metadata?.generatorSubcommands?.scaffold?.optionNames?.includes("surface"), true);
  assert.equal(packageMetadata.metadata?.generatorSubcommands?.scaffold?.optionNames?.includes("access"), true);
  assert.equal(packageMetadata.metadata?.generatorSubcommands?.scaffold?.optionNames?.includes("force"), true);
  assert.equal(packageMetadata.metadata?.generatorSubcommands?.scaffold?.optionNames?.includes("internal"), true);
  assert.equal(packageMetadata.metadata?.generatorSubcommands?.scaffold?.optionNames?.includes("grant-role"), true);
  assert.equal(
    packageMetadata.mutations?.dependencies?.runtime?.["@jskit-ai/auth-core"],
    packageJson.dependencies?.["@jskit-ai/auth-core"]
  );
  assert.equal(packageMetadata.metadata?.generatorSubcommands?.scaffold?.optionNames?.includes("no-role-grant"), true);
  assert.equal(packageMetadata.metadata?.generatorSubcommands?.scaffold?.createTarget?.pathTemplate, "packages/${option:namespace|kebab}");
  assert.deepEqual(packageMetadata.lifecycle?.install?.prepare, {
    entrypoint: "src/server/buildTemplateContext.js",
    export: "prepareInstallHook"
  });
});

test("crud-server-generator metadata has one shared resource definition", () => {
  const files = packageMetadata.mutations?.files || [];
  const jsonRestResourceTemplate = files.find((entry) => entry.from === "templates/src/local-package/server/jsonRestResource.js");

  assert.equal(jsonRestResourceTemplate, undefined);
});

test("crud-server-generator defers foreign keys until every table migration has run", () => {
  const migrations = (packageMetadata.mutations?.files || []).filter(
    (entry) => entry.op === "install-migration"
  );
  const initial = migrations.find((entry) => entry.id === "crud-initial-schema-${option:namespace|snake}");
  const foreignKeys = migrations.find((entry) => entry.id === "crud-foreign-keys-${option:namespace|snake}");

  assert.equal(initial?.toDir, "migrations");
  assert.equal(foreignKeys?.toDir, "migrations/constraints");
  assert.equal(foreignKeys?.from, "templates/migrations/crud_foreign_keys.cjs");
  assert.deepEqual(foreignKeys?.templateContext, {
    entrypoint: "src/server/buildTemplateContext.js",
    export: "buildTemplateContext"
  });
});

test("crud-server-generator wires action and role mutations through template context", () => {
  const files = packageMetadata.mutations?.files || [];
  const manifestTemplate = files.find((entry) => entry.from === "templates/src/local-package/package.json");
  const actionsTemplate = files.find((entry) => entry.from === "templates/src/local-package/server/actions.js");
  const routesTemplate = files.find((entry) => entry.from === "templates/src/local-package/server/registerRoutes.js");
  const roleGrantMutation = (packageMetadata.mutations?.text || []).find((entry) => entry.file === "config/roles.js");

  assert.ok(manifestTemplate);
  assert.deepEqual(manifestTemplate.templateContext, {
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
