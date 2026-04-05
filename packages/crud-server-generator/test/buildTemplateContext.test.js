import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildTemplateContext, __testables } from "../src/server/buildTemplateContext.js";

function createSnapshot({
  tableName = "contacts",
  hasWorkspaceOwnerColumn = true,
  hasUserOwnerColumn = true,
  hasCreatedAtColumn = true
} = {}) {
  const createdAtColumn = hasCreatedAtColumn
    ? [
        Object.freeze({
          name: "created_at",
          key: "createdAt",
          dataType: "datetime",
          columnType: "datetime",
          typeKind: "datetime",
          nullable: false,
          hasDefault: true,
          defaultValue: "CURRENT_TIMESTAMP",
          autoIncrement: false,
          unsigned: false,
          extra: "",
          maxLength: null,
          numericPrecision: null,
          numericScale: null,
          enumValues: Object.freeze([])
        })
      ]
    : [];
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
      ...createdAtColumn,
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
    indexes: Object.freeze([]),
    foreignKeys: Object.freeze([])
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
  assert.equal(replacements.__JSKIT_CRUD_RESOURCE_FIELD_META_PUSH_LINES__, "");
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
  assert.match(
    replacements.__JSKIT_CRUD_LIST_CONFIG_LINES__,
    /orderBy: \[\s+{\s+column: "created_at",\s+direction: "desc"\s+}\s+\]/s
  );
  assert.match(
    replacements.__JSKIT_CRUD_LIST_CONFIG_LINES__,
    /\/\/ searchColumns: \["name"\],\s+orderBy:/s
  );
  assert.doesNotMatch(
    replacements.__JSKIT_CRUD_RESOURCE_OUTPUT_NORMALIZATION_LINES__,
    /== null \?/
  );
  assert.equal(replacements.__JSKIT_CRUD_RESOURCE_CREATE_REQUIRED_FIELDS__, "[\"firstName\"]");
  assert.equal(replacements.__JSKIT_CRUD_MIGRATION_FOREIGN_KEY_LINES__, "");
});

test("buildReplacementsFromSnapshot omits default list ordering when created_at is absent", () => {
  const snapshot = createSnapshot({
    hasCreatedAtColumn: false
  });
  const replacements = __testables.buildReplacementsFromSnapshot({
    namespace: "contacts",
    snapshot,
    resolvedOwnershipFilter: "workspace_user"
  });

  assert.doesNotMatch(replacements.__JSKIT_CRUD_LIST_CONFIG_LINES__, /orderBy/);
  assert.match(replacements.__JSKIT_CRUD_LIST_CONFIG_LINES__, /searchColumns/);
});

test("buildReplacementsFromSnapshot renders append-only field meta entries from foreign keys", () => {
  const snapshot = {
    ...createSnapshot(),
    columns: Object.freeze([
      ...createSnapshot().columns,
      Object.freeze({
        name: "vet_id",
        key: "vetId",
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
      })
    ]),
    foreignKeys: Object.freeze([
      Object.freeze({
        name: "contacts_vet_id_foreign",
        referencedTableName: "customer_categories",
        updateRule: "CASCADE",
        deleteRule: "SET NULL",
        columns: Object.freeze([
          Object.freeze({
            name: "vet_id",
            referencedName: "id"
          })
        ])
      })
    ])
  };

  const replacements = __testables.buildReplacementsFromSnapshot({
    snapshot,
    resolvedOwnershipFilter: "workspace_user"
  });

  assert.match(replacements.__JSKIT_CRUD_RESOURCE_FIELD_META_PUSH_LINES__, /RESOURCE_FIELD_META\.push\(\{/);
  assert.match(replacements.__JSKIT_CRUD_RESOURCE_FIELD_META_PUSH_LINES__, /key: "vetId"/);
  assert.match(replacements.__JSKIT_CRUD_RESOURCE_FIELD_META_PUSH_LINES__, /namespace: "customer-categories"/);
  assert.match(
    replacements.__JSKIT_CRUD_RESOURCE_FIELD_META_PUSH_LINES__,
    /formControl: "autocomplete" \/\/ or "select"/
  );
  assert.match(replacements.__JSKIT_CRUD_MIGRATION_FOREIGN_KEY_LINES__, /table\.foreign\(\["vet_id"\]/);
});

test("buildReplacementsFromSnapshot renders enum field meta options as select controls", () => {
  const baseSnapshot = createSnapshot({
    hasWorkspaceOwnerColumn: false,
    hasUserOwnerColumn: false
  });
  const snapshot = {
    ...baseSnapshot,
    columns: Object.freeze([
      ...baseSnapshot.columns,
      Object.freeze({
        name: "temperament",
        key: "temperament",
        dataType: "enum",
        columnType: "enum('relaxed','friendly_excitable','unknown')",
        typeKind: "string",
        nullable: false,
        hasDefault: false,
        defaultValue: null,
        autoIncrement: false,
        unsigned: false,
        extra: "",
        maxLength: null,
        numericPrecision: null,
        numericScale: null,
        enumValues: Object.freeze(["relaxed", "friendly_excitable", "unknown"])
      })
    ])
  };

  const replacements = __testables.buildReplacementsFromSnapshot({
    snapshot,
    resolvedOwnershipFilter: "public"
  });

  assert.match(replacements.__JSKIT_CRUD_RESOURCE_FIELD_META_PUSH_LINES__, /key: "temperament"/);
  assert.match(replacements.__JSKIT_CRUD_RESOURCE_FIELD_META_PUSH_LINES__, /formControl: "select"/);
  assert.match(replacements.__JSKIT_CRUD_RESOURCE_FIELD_META_PUSH_LINES__, /options: \[/);
  assert.match(replacements.__JSKIT_CRUD_RESOURCE_FIELD_META_PUSH_LINES__, /"value": "friendly_excitable"/);
  assert.match(replacements.__JSKIT_CRUD_RESOURCE_FIELD_META_PUSH_LINES__, /"label": "Friendly Excitable"/);
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
    /normalizeIfInSource\(source, normalized, "scheduledAt", \(value\) => \{ const normalized = normalizeText\(value\); return normalized \? toDatabaseDateTimeUtc\(normalized\) : null; \}\);/
  );
  assert.match(
    replacements.__JSKIT_CRUD_RESOURCE_INPUT_NORMALIZATION_LINES__,
    /normalizeIfInSource\(source, normalized, "birthDate", \(value\) => \{ const normalized = normalizeText\(value\); return normalized \? toIsoString\(normalized\)\.slice\(0, 10\) : null; \}\);/
  );
  assert.match(
    replacements.__JSKIT_CRUD_RESOURCE_INPUT_NORMALIZATION_LINES__,
    /normalizeIfInSource\(source, normalized, "preferredTime", \(value\) => \{ const normalized = normalizeText\(value\); return normalized \|\| null; \}\);/
  );
});

test("crud repository template defines explicit one-line CRUD methods over repository primitives", async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const templatePath = path.resolve(testDirectory, "..", "templates", "src", "local-package", "server", "repository.js");
  const templateSource = await readFile(templatePath, "utf8");
  assert.match(
    templateSource,
    /from "@jskit-ai\/crud-core\/server\/repositoryMethods";/
  );
  assert.match(templateSource, /import \{ LIST_CONFIG \} from "\.\/listConfig\.js";/);
  assert.match(templateSource, /const repositoryRuntime = createCrudRepositoryRuntime\(/);
  assert.match(templateSource, /return crudRepositoryList\(repositoryRuntime, knex, query, options, callOptions\);/);
  assert.match(templateSource, /return crudRepositoryFindById\(repositoryRuntime, knex, recordId, options, callOptions\);/);
  assert.match(templateSource, /return crudRepositoryListByIds\(repositoryRuntime, knex, ids, options, callOptions\);/);
  assert.match(templateSource, /return crudRepositoryCreate\(repositoryRuntime, knex, payload, options, callOptions\);/);
  assert.match(templateSource, /return crudRepositoryUpdateById\(repositoryRuntime, knex, recordId, patch, options, callOptions\);/);
  assert.match(templateSource, /return crudRepositoryDeleteById\(repositoryRuntime, knex, recordId, options, callOptions\);/);
});

test("crud actions and routes templates share LIST_CONFIG for cursor validation", async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const actionsTemplatePath = path.resolve(testDirectory, "..", "templates", "src", "local-package", "server", "actions.js");
  const registerRoutesTemplatePath = path.resolve(testDirectory, "..", "templates", "src", "local-package", "server", "registerRoutes.js");
  const listConfigTemplatePath = path.resolve(testDirectory, "..", "templates", "src", "local-package", "server", "listConfig.js");

  const actionsTemplateSource = await readFile(actionsTemplatePath, "utf8");
  const registerRoutesTemplateSource = await readFile(registerRoutesTemplatePath, "utf8");
  const listConfigTemplateSource = await readFile(listConfigTemplatePath, "utf8");

  assert.match(actionsTemplateSource, /createCrudCursorPaginationQueryValidator/);
  assert.match(actionsTemplateSource, /import \{ LIST_CONFIG \} from "\.\/listConfig\.js";/);
  assert.match(actionsTemplateSource, /const listCursorPaginationQueryValidator = createCrudCursorPaginationQueryValidator\(LIST_CONFIG\);/);
  assert.match(registerRoutesTemplateSource, /createCrudCursorPaginationQueryValidator/);
  assert.match(registerRoutesTemplateSource, /import \{ LIST_CONFIG \} from "\.\/listConfig\.js";/);
  assert.match(registerRoutesTemplateSource, /const listCursorPaginationQueryValidator = createCrudCursorPaginationQueryValidator\(LIST_CONFIG\);/);
  assert.match(listConfigTemplateSource, /const LIST_CONFIG = Object\.freeze\(\{/);
  assert.match(listConfigTemplateSource, /__JSKIT_CRUD_LIST_CONFIG_LINES__/);
});

test("crud service template defines explicit service methods and semi-explicit default events", async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const templatePath = path.resolve(testDirectory, "..", "templates", "src", "local-package", "server", "service.js");
  const templateSource = await readFile(templatePath, "utf8");

  assert.match(
    templateSource,
    /from "@jskit-ai\/crud-core\/server\/serviceEvents";/
  );
  assert.match(
    templateSource,
    /from "@jskit-ai\/crud-core\/server\/fieldAccess";/
  );
  assert.match(templateSource, /const baseServiceEvents = createCrudServiceEvents\(/);
  assert.match(templateSource, /const fieldAccessRuntime = createCrudFieldAccessRuntime\(/);
  assert.match(templateSource, /const serviceEvents = Object\.freeze\(\{/);
  assert.match(templateSource, /createRecord: \[\.\.\.baseServiceEvents\.createRecord\],/);
  assert.match(templateSource, /async function listRecords\(query = \{\}, options = \{\}\)/);
  assert.match(templateSource, /return fieldAccessRuntime\.filterReadableListResult\(result, fieldAccess, \{/);
  assert.match(templateSource, /const writablePayload = await fieldAccessRuntime\.enforceWritablePayload\(payload, fieldAccess, \{/);
  assert.match(templateSource, /throw new AppError\(404, "Record not found\."\);/);
});

test("crud provider template uses shared lookup provider helpers instead of inline wiring", async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const templatePath = path.resolve(testDirectory, "..", "templates", "src", "local-package", "server", "CrudProvider.js");
  const templateSource = await readFile(templatePath, "utf8");

  assert.match(
    templateSource,
    /from "@jskit-ai\/crud-core\/server\/lookupProviders";/
  );
  assert.match(templateSource, /resolveLookupProvider: createCrudLookupProviderResolver\(scope\)/);
  assert.match(
    templateSource,
    /return createCrudLookupProvider\(scope\.make\("repository\.\$\{option:namespace\|snake\}"\), \{\s*ownershipFilter: crudPolicy\.ownershipFilter\s*\}\);/
  );
  assert.doesNotMatch(templateSource, /normalizePathname\(relation\.apiPath\)/);
});
