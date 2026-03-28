import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildTemplateContext, __testables } from "../src/server/buildTemplateContext.js";

function createSnapshot({
  tableName = "contacts",
  hasWorkspaceOwnerColumn = true,
  hasUserOwnerColumn = true
} = {}) {
  return Object.freeze({
    tableName,
    idColumn: "id",
    primaryKeyColumns: Object.freeze(["id"]),
    hasWorkspaceOwnerColumn,
    hasUserOwnerColumn,
    columns: Object.freeze([
      Object.freeze({
        name: "id",
        key: "id",
        dataType: "int",
        columnType: "int unsigned",
        typeKind: "integer",
        nullable: false,
        hasDefault: false,
        defaultValue: null,
        autoIncrement: true,
        unsigned: true,
        extra: "",
        maxLength: null,
        numericPrecision: 10,
        numericScale: 0,
        enumValues: Object.freeze([])
      }),
      Object.freeze({
        name: "workspace_owner_id",
        key: "workspaceOwnerId",
        dataType: "int",
        columnType: "int unsigned",
        typeKind: "integer",
        nullable: true,
        hasDefault: false,
        defaultValue: null,
        autoIncrement: false,
        unsigned: true,
        extra: "",
        maxLength: null,
        numericPrecision: 10,
        numericScale: 0,
        enumValues: Object.freeze([])
      }),
      Object.freeze({
        name: "user_owner_id",
        key: "userOwnerId",
        dataType: "int",
        columnType: "int unsigned",
        typeKind: "integer",
        nullable: true,
        hasDefault: false,
        defaultValue: null,
        autoIncrement: false,
        unsigned: true,
        extra: "",
        maxLength: null,
        numericPrecision: 10,
        numericScale: 0,
        enumValues: Object.freeze([])
      }),
      Object.freeze({
        name: "first_name",
        key: "firstName",
        dataType: "varchar",
        columnType: "varchar(160)",
        typeKind: "string",
        nullable: false,
        hasDefault: false,
        defaultValue: null,
        autoIncrement: false,
        unsigned: false,
        extra: "",
        maxLength: 160,
        numericPrecision: null,
        numericScale: null,
        enumValues: Object.freeze([])
      }),
      Object.freeze({
        name: "updated_at",
        key: "updatedAt",
        dataType: "datetime",
        columnType: "datetime",
        typeKind: "datetime",
        nullable: false,
        hasDefault: true,
        defaultValue: "CURRENT_TIMESTAMP",
        autoIncrement: false,
        unsigned: false,
        extra: "on update current_timestamp",
        maxLength: null,
        numericPrecision: null,
        numericScale: null,
        enumValues: Object.freeze([])
      })
    ]),
    indexes: Object.freeze([])
  });
}

test("resolveOwnershipFilterForGeneration infers ownership filter for table introspection mode", () => {
  const snapshotBoth = createSnapshot({
    hasWorkspaceOwnerColumn: true,
    hasUserOwnerColumn: true
  });
  const snapshotWorkspaceOnly = createSnapshot({
    hasWorkspaceOwnerColumn: true,
    hasUserOwnerColumn: false
  });
  const snapshotUserOnly = createSnapshot({
    hasWorkspaceOwnerColumn: false,
    hasUserOwnerColumn: true
  });
  const snapshotPublic = createSnapshot({
    hasWorkspaceOwnerColumn: false,
    hasUserOwnerColumn: false
  });

  assert.equal(
    __testables.resolveOwnershipFilterForGeneration(snapshotBoth, "auto", {
      enforceTableColumns: true
    }),
    "workspace_user"
  );
  assert.equal(
    __testables.resolveOwnershipFilterForGeneration(snapshotWorkspaceOnly, "auto", {
      enforceTableColumns: true
    }),
    "workspace"
  );
  assert.equal(
    __testables.resolveOwnershipFilterForGeneration(snapshotUserOnly, "auto", {
      enforceTableColumns: true
    }),
    "user"
  );
  assert.equal(
    __testables.resolveOwnershipFilterForGeneration(snapshotPublic, "auto", {
      enforceTableColumns: true
    }),
    "public"
  );
});

test("resolveOwnershipFilterForGeneration rejects explicit ownership filters when required columns are missing", () => {
  const snapshotPublic = createSnapshot({
    hasWorkspaceOwnerColumn: false,
    hasUserOwnerColumn: false
  });

  assert.throws(
    () =>
      __testables.resolveOwnershipFilterForGeneration(snapshotPublic, "workspace", {
        enforceTableColumns: true
      }),
    /requires column "workspace_owner_id"/
  );
  assert.throws(
    () =>
      __testables.resolveOwnershipFilterForGeneration(snapshotPublic, "user", {
        enforceTableColumns: true
      }),
    /requires column "user_owner_id"/
  );
});

test("buildTemplateContext requires table-name", async () => {
  await assert.rejects(
    buildTemplateContext({
      appRoot: process.cwd(),
      options: {
        namespace: "contacts"
      }
    }),
    /requires option "table-name"/
  );
});

test("buildReplacementsFromSnapshot builds deterministic template replacement payload", () => {
  const snapshot = createSnapshot();
  const replacements = __testables.buildReplacementsFromSnapshot({
    namespace: "contacts",
    snapshot,
    resolvedOwnershipFilter: "workspace_user"
  });

  assert.equal(replacements.__JSKIT_CRUD_TABLE_NAME__, "\"contacts\"");
  assert.equal(replacements.__JSKIT_CRUD_ID_COLUMN__, "\"id\"");
  assert.equal(replacements.__JSKIT_CRUD_RESOLVED_OWNERSHIP_FILTER__, "workspace_user");
  assert.match(replacements.__JSKIT_CRUD_MIGRATION_COLUMN_LINES__, /table\.increments\("id"\)/);
  assert.match(replacements.__JSKIT_CRUD_MIGRATION_COLUMN_LINES__, /table\.string\("first_name", 160\)/);
  assert.match(replacements.__JSKIT_CRUD_REPOSITORY_OUTPUT_KEYS__, /"firstName"/);
  assert.match(replacements.__JSKIT_CRUD_REPOSITORY_WRITE_KEYS__, /"firstName"/);
  assert.equal(replacements.__JSKIT_CRUD_REPOSITORY_COLUMN_OVERRIDES__, "{}");
  assert.match(replacements.__JSKIT_CRUD_RESOURCE_OUTPUT_SCHEMA_PROPERTIES__, /updatedAt: Type\.String/);
  assert.match(
    replacements.__JSKIT_CRUD_RESOURCE_OUTPUT_SCHEMA_PROPERTIES__,
    /id: Type\.Integer\(\{ minimum: 1 \}\),/
  );
  assert.match(replacements.__JSKIT_CRUD_RESOURCE_CREATE_SCHEMA_PROPERTIES__, /firstName: Type\.String/);
  assert.match(
    replacements.__JSKIT_CRUD_RESOURCE_INPUT_NORMALIZATION_LINES__,
    /normalizeIfInSource\(source, normalized, "firstName", normalizeText\);/
  );
  assert.doesNotMatch(
    replacements.__JSKIT_CRUD_RESOURCE_INPUT_NORMALIZATION_LINES__,
    /\(value\) =>/
  );
  assert.doesNotMatch(
    replacements.__JSKIT_CRUD_RESOURCE_INPUT_NORMALIZATION_LINES__,
    /value == null/
  );
  assert.match(
    replacements.__JSKIT_CRUD_RESOURCE_OUTPUT_NORMALIZATION_LINES__,
    /firstName: normalizeIfPresent\(source\.firstName, normalizeText\),/
  );
  assert.doesNotMatch(
    replacements.__JSKIT_CRUD_RESOURCE_OUTPUT_NORMALIZATION_LINES__,
    /== null \?/
  );
  assert.equal(replacements.__JSKIT_CRUD_RESOURCE_CREATE_REQUIRED_FIELDS__, "[\"firstName\"]");
});

test("renderMigrationColumnLine ignores SQL NULL string defaults", () => {
  const line = __testables.renderMigrationColumnLine(
    {
      name: "workspace_owner_id",
      dataType: "int",
      columnType: "int unsigned",
      typeKind: "integer",
      nullable: true,
      hasDefault: true,
      defaultValue: "NULL",
      autoIncrement: false,
      unsigned: true,
      extra: "",
      maxLength: null,
      numericPrecision: 10,
      numericScale: 0,
      enumValues: []
    },
    {
      idColumn: "id",
      primaryKeyColumns: ["id"]
    }
  );

  assert.equal(line.includes(".defaultTo("), false);
});

test("buildReplacementsFromSnapshot normalizes nullable temporal inputs without invalid date errors", () => {
  const snapshot = createSnapshot({
    hasWorkspaceOwnerColumn: false,
    hasUserOwnerColumn: false
  });
  const temporalColumns = [
    ...snapshot.columns.filter((column) => column.key !== "updatedAt"),
    Object.freeze({
      name: "scheduled_at",
      key: "scheduledAt",
      dataType: "datetime",
      columnType: "datetime",
      typeKind: "datetime",
      nullable: true,
      hasDefault: false,
      defaultValue: null,
      autoIncrement: false,
      unsigned: false,
      extra: "",
      maxLength: null,
      numericPrecision: null,
      numericScale: null,
      enumValues: Object.freeze([])
    }),
    Object.freeze({
      name: "birth_date",
      key: "birthDate",
      dataType: "date",
      columnType: "date",
      typeKind: "date",
      nullable: true,
      hasDefault: false,
      defaultValue: null,
      autoIncrement: false,
      unsigned: false,
      extra: "",
      maxLength: null,
      numericPrecision: null,
      numericScale: null,
      enumValues: Object.freeze([])
    }),
    Object.freeze({
      name: "preferred_time",
      key: "preferredTime",
      dataType: "time",
      columnType: "time",
      typeKind: "time",
      nullable: true,
      hasDefault: false,
      defaultValue: null,
      autoIncrement: false,
      unsigned: false,
      extra: "",
      maxLength: null,
      numericPrecision: null,
      numericScale: null,
      enumValues: Object.freeze([])
    })
  ];

  const replacements = __testables.buildReplacementsFromSnapshot({
    namespace: "contacts",
    snapshot: {
      ...snapshot,
      columns: Object.freeze(temporalColumns)
    },
    resolvedOwnershipFilter: "public"
  });

  assert.match(
    replacements.__JSKIT_CRUD_RESOURCE_INPUT_NORMALIZATION_LINES__,
    /normalizeIfInSource\(source, normalized, "scheduledAt", normalizeNullableDateTimeInput\);/
  );
  assert.match(
    replacements.__JSKIT_CRUD_RESOURCE_INPUT_NORMALIZATION_LINES__,
    /normalizeIfInSource\(source, normalized, "birthDate", normalizeNullableDateInput\);/
  );
  assert.match(
    replacements.__JSKIT_CRUD_RESOURCE_INPUT_NORMALIZATION_LINES__,
    /normalizeIfInSource\(source, normalized, "preferredTime", normalizeNullableTimeInput\);/
  );
  assert.match(
    replacements.__JSKIT_CRUD_RESOURCE_INPUT_NORMALIZER_SUPPORT__,
    /function normalizeNullableDateTimeInput\(value\)/
  );
  assert.match(
    replacements.__JSKIT_CRUD_RESOURCE_INPUT_NORMALIZER_SUPPORT__,
    /function normalizeNullableDateInput\(value\)/
  );
  assert.match(
    replacements.__JSKIT_CRUD_RESOURCE_INPUT_NORMALIZER_SUPPORT__,
    /function normalizeNullableTimeInput\(value\)/
  );
});

test("crud repository template imports buildRepositoryColumnMetadata when used", async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const templatePath = path.resolve(testDirectory, "..", "templates", "src", "local-package", "server", "repository.js");
  const templateSource = await readFile(templatePath, "utf8");
  const importBlockMatch = templateSource.match(
    /import\s*\{[\s\S]*?\}\s*from "@jskit-ai\/crud-core\/server\/repositorySupport";/
  );

  assert.ok(importBlockMatch);
  assert.match(importBlockMatch[0], /buildRepositoryColumnMetadata/);
  assert.match(templateSource, /buildRepositoryColumnMetadata\(\{/);
});
