import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { __testables } from "../src/server/buildTemplateContext.js";

function createSnapshot({
  tableName = "contacts",
  hasWorkspaceIdColumn = true,
  hasUserIdColumn = true,
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
          datetimePrecision: null,
          characterSetName: "",
          collationName: "",
          enumValues: Object.freeze([])
        })
      ]
    : [];
  return Object.freeze({
    tableName,
    tableCollation: "utf8mb4_general_ci",
    idColumn: "id",
    primaryKeyColumns: Object.freeze(["id"]),
    hasWorkspaceIdColumn,
    hasUserIdColumn,
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
        datetimePrecision: null,
        characterSetName: "",
        collationName: "",
        enumValues: Object.freeze([])
      }),
      Object.freeze({
        name: "workspace_id",
        key: "workspaceId",
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
        datetimePrecision: null,
        characterSetName: "",
        collationName: "",
        enumValues: Object.freeze([])
      }),
      Object.freeze({
        name: "user_id",
        key: "userId",
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
        datetimePrecision: null,
        characterSetName: "",
        collationName: "",
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
        datetimePrecision: null,
        characterSetName: "utf8mb4",
        collationName: "utf8mb4_general_ci",
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
        datetimePrecision: null,
        characterSetName: "",
        collationName: "",
        enumValues: Object.freeze([])
      })
    ]),
    indexes: Object.freeze([]),
    foreignKeys: Object.freeze([]),
    checkConstraints: Object.freeze([])
  });
}

async function withTempApp(run, publicConfigSource) {
  const appRoot = await mkdtemp(path.join(tmpdir(), "crud-server-generator-"));
  try {
    await mkdir(path.join(appRoot, "config"), { recursive: true });
    await writeFile(
      path.join(appRoot, "package.json"),
      `${JSON.stringify({ name: "crud-server-generator-test-app", private: true, type: "module" }, null, 2)}\n`,
      "utf8"
    );
    await writeFile(path.join(appRoot, "config", "public.js"), publicConfigSource, "utf8");
    return await run(appRoot);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
}

test("resolveOwnershipFilterForGeneration infers ownership filter for table introspection mode", () => {
  const snapshotBoth = createSnapshot({
    hasWorkspaceIdColumn: true,
    hasUserIdColumn: true
  });
  const snapshotWorkspaceOnly = createSnapshot({
    hasWorkspaceIdColumn: true,
    hasUserIdColumn: false
  });
  const snapshotUserOnly = createSnapshot({
    hasWorkspaceIdColumn: false,
    hasUserIdColumn: true
  });
  const snapshotPublic = createSnapshot({
    hasWorkspaceIdColumn: false,
    hasUserIdColumn: false
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
    hasWorkspaceIdColumn: false,
    hasUserIdColumn: false
  });

  assert.throws(
    () =>
      __testables.resolveOwnershipFilterForGeneration(snapshotPublic, "workspace", {
        enforceTableColumns: true
      }),
    /requires column "workspace_id"/
  );
  assert.throws(
    () =>
      __testables.resolveOwnershipFilterForGeneration(snapshotPublic, "user", {
        enforceTableColumns: true
      }),
    /requires column "user_id"/
  );
});

test("buildReplacementsFromSnapshot renders an internal route line only when requested", () => {
  const snapshot = createSnapshot();

  const publicReplacements = __testables.buildReplacementsFromSnapshot({
    namespace: "customers",
    snapshot,
    resolvedOwnershipFilter: "workspace_user",
    surfaceRequiresWorkspace: true,
    surfaceId: "admin",
    routeInternal: false
  });
  const internalReplacements = __testables.buildReplacementsFromSnapshot({
    namespace: "customers",
    snapshot,
    resolvedOwnershipFilter: "workspace_user",
    surfaceRequiresWorkspace: true,
    surfaceId: "admin",
    routeInternal: true
  });

  assert.equal(publicReplacements.__JSKIT_CRUD_ROUTE_INTERNAL_LINE__, "");
  assert.equal(internalReplacements.__JSKIT_CRUD_ROUTE_INTERNAL_LINE__, "      internal: true,");
});

test("resolveInternalRouteOption rejects invalid internal flag values instead of silently generating public routes", () => {
  assert.throws(
    () => __testables.resolveInternalRouteOption({ internal: "maybe" }),
    /Boolean field must be true or false/
  );
});

test("resolveCrudGenerationTableName defaults table-name from namespace", () => {
  assert.equal(
    __testables.resolveCrudGenerationTableName({
      namespace: "contacts"
    }),
    "contacts"
  );
  assert.equal(
    __testables.resolveCrudGenerationTableName({
      namespace: "contacts",
      "table-name": "customer_contacts"
    }),
    "customer_contacts"
  );
});

test("buildReplacementsFromSnapshot builds deterministic template replacement payload", () => {
  const snapshot = createSnapshot();
  const replacements = __testables.buildReplacementsFromSnapshot({
    namespace: "contacts",
    snapshot,
    resolvedOwnershipFilter: "workspace_user",
    surfaceRequiresWorkspace: true
  });

  assert.equal(replacements.__JSKIT_CRUD_TABLE_NAME__, "\"contacts\"");
  assert.equal(replacements.__JSKIT_CRUD_ID_COLUMN__, "\"id\"");
  assert.equal(replacements.__JSKIT_CRUD_SURFACE_ID__, "\"\"");
  assert.equal(replacements.__JSKIT_CRUD_RESOLVED_OWNERSHIP_FILTER__, "workspace_user");
  assert.match(
    replacements.__JSKIT_CRUD_ACTION_PERMISSION_SUPPORT__,
    /const actionPermissions = Object\.freeze\(\{/
  );
  assert.match(
    replacements.__JSKIT_CRUD_ACTION_PERMISSION_SUPPORT__,
    /"crud\.contacts\.delete"/
  );
  assert.equal(
    replacements.__JSKIT_CRUD_LIST_ACTION_PERMISSION__,
    '{ require: "all", permissions: [actionPermissions.list] }'
  );
  assert.match(
    replacements.__JSKIT_CRUD_ACTION_WORKSPACE_VALIDATOR_IMPORT__,
    /workspaceSlugParamsValidator/
  );
  assert.match(
    replacements.__JSKIT_CRUD_ROUTE_WORKSPACE_SUPPORT_IMPORTS__,
    /buildWorkspaceInputFromRouteParams/
  );
  assert.equal(replacements.__JSKIT_CRUD_ROUTE_SURFACE_REQUIRES_WORKSPACE__, "true");
  assert.match(replacements.__JSKIT_CRUD_LIST_ACTION_INPUT__, /composeSchemaDefinitions\(\[/);
  assert.match(replacements.__JSKIT_CRUD_LIST_ACTION_INPUT__, /workspaceSlugParamsValidator,/);
  assert.equal(
    replacements.__JSKIT_CRUD_VIEW_ROUTE_PARAMS_VALIDATOR_LINE__,
    "      params: recordRouteParamsValidator,"
  );
  assert.match(
    replacements.__JSKIT_CRUD_ROUTE_VALIDATOR_CONSTANTS__,
    /const recordRouteParamsValidator = composeSchemaDefinitions\(/
  );
  assert.match(
    replacements.__JSKIT_CRUD_ROLE_CATALOG_PERMISSION_GRANTS__,
    /roleCatalog\.roles\.member\.permissions\.push\(/
  );
  assert.match(
    replacements.__JSKIT_CRUD_ROLE_CATALOG_PERMISSION_GRANTS__,
    /"crud\.contacts\.delete"/
  );
  assert.match(replacements.__JSKIT_CRUD_MIGRATION_COLUMN_LINES__, /table\.bigIncrements\("id"\)/);
  assert.match(replacements.__JSKIT_CRUD_MIGRATION_COLUMN_LINES__, /table\.string\("first_name", 160\)/);
  assert.equal(Object.hasOwn(replacements, "__JSKIT_CRUD_RESOURCE_OUTPUT_SCHEMA_PROPERTIES__"), false);
  assert.equal(Object.hasOwn(replacements, "__JSKIT_CRUD_RESOURCE_CREATE_SCHEMA_PROPERTIES__"), false);
  assert.equal(Object.hasOwn(replacements, "__JSKIT_CRUD_RESOURCE_PATCH_SCHEMA_PROPERTIES__"), false);
  assert.match(replacements.__JSKIT_CRUD_RESOURCE_SCHEMA_PROPERTIES__, /updatedAt: \{/);
  assert.match(
    replacements.__JSKIT_CRUD_RESOURCE_SCHEMA_PROPERTIES__,
    /firstName: \{[\s\S]*type: "string",[\s\S]*maxLength: 160,[\s\S]*required: true,[\s\S]*search: true,[\s\S]*output: \{ required: true \},[\s\S]*create: \{ required: true \},[\s\S]*patch: \{ required: false \}[\s\S]*\},/s
  );
  assert.match(
    replacements.__JSKIT_CRUD_RESOURCE_SCHEMA_PROPERTIES__,
    /createdAt: \{[\s\S]*type: "dateTime",[\s\S]*default: "now\(\)",[\s\S]*storage: \{ writeSerializer: "datetime-utc" \}[\s\S]*output: \{ required: true \}[\s\S]*\},/s
  );
  assert.doesNotMatch(replacements.__JSKIT_CRUD_RESOURCE_SCHEMA_PROPERTIES__, /^\s*id:\s*\{/m);
  assert.doesNotMatch(replacements.__JSKIT_CRUD_RESOURCE_SCHEMA_PROPERTIES__, /pattern: RECORD_ID_PATTERN/);
  assert.match(
    replacements.__JSKIT_CRUD_JSONREST_SCHEMA_PROPERTIES__,
    /createdAt: \{[\s\S]*storage: \{ serialize: serializeNullableDateTime \}[\s\S]*\},/s
  );
  assert.doesNotMatch(
    replacements.__JSKIT_CRUD_JSONREST_SCHEMA_PROPERTIES__,
    /workspaceId: \{[^}]*storage: \{/s
  );
  assert.doesNotMatch(
    replacements.__JSKIT_CRUD_JSONREST_SCHEMA_PROPERTIES__,
    /howManyCars: \{[^}]*storage: \{/s
  );
  assert.doesNotMatch(
    replacements.__JSKIT_CRUD_JSONREST_SCHEMA_PROPERTIES__,
    /^\s*id:\s*\{/m
  );
  assert.equal(replacements.__JSKIT_CRUD_MIGRATION_FOREIGN_KEY_LINES__, "");
});

test("buildReplacementsFromSnapshot omits named permissions and role grants when disabled", () => {
  const replacements = __testables.buildReplacementsFromSnapshot({
    namespace: "contacts",
    snapshot: createSnapshot({
      hasWorkspaceIdColumn: false,
      hasUserIdColumn: false
    }),
    resolvedOwnershipFilter: "public",
    surfaceRequiresWorkspace: false
  });

  assert.match(
    replacements.__JSKIT_CRUD_ACTION_PERMISSION_SUPPORT__,
    /const authenticatedPermission = Object\.freeze\(\{/
  );
  assert.equal(replacements.__JSKIT_CRUD_SURFACE_ID__, "\"\"");
  assert.equal(replacements.__JSKIT_CRUD_LIST_ACTION_PERMISSION__, "authenticatedPermission");
  assert.equal(replacements.__JSKIT_CRUD_DELETE_ACTION_PERMISSION__, "authenticatedPermission");
  assert.equal(replacements.__JSKIT_CRUD_ROLE_CATALOG_PERMISSION_GRANTS__, "");
  assert.equal(replacements.__JSKIT_CRUD_ACTION_WORKSPACE_VALIDATOR_IMPORT__, "");
  assert.equal(replacements.__JSKIT_CRUD_ROUTE_WORKSPACE_SUPPORT_IMPORTS__, "");
  assert.equal(replacements.__JSKIT_CRUD_ROUTE_SURFACE_REQUIRES_WORKSPACE__, "false");
  assert.equal(replacements.__JSKIT_CRUD_CREATE_ACTION_INPUT__, "resource.operations.create.body");
  assert.equal(replacements.__JSKIT_CRUD_DELETE_ACTION_INPUT__, "recordIdParamsValidator");
  assert.equal(replacements.__JSKIT_CRUD_LIST_ROUTE_PARAMS_VALIDATOR_LINE__, "");
  assert.equal(
    replacements.__JSKIT_CRUD_VIEW_ROUTE_PARAMS_VALIDATOR_LINE__,
    "      params: recordRouteParamsValidator,"
  );
  assert.equal(
    replacements.__JSKIT_CRUD_VIEW_ROUTE_INPUT_LINES__,
    [
      "          recordId: request.input.params.recordId,",
      "          ...(request.input.query || {})"
    ].join("\n")
  );
});

test("resolveCrudSurfaceRequiresWorkspace follows surface workspace requirements from app config", async () => {
  await withTempApp(
    async (appRoot) => {
      assert.equal(
        await __testables.resolveCrudSurfaceRequiresWorkspace({
          appRoot,
          options: {
            namespace: "contacts",
            surface: "home",
            "ownership-filter": "auto"
          }
        }),
        false
      );

      assert.equal(
        await __testables.resolveCrudSurfaceRequiresWorkspace({
          appRoot,
          options: {
            namespace: "contacts",
            surface: "admin",
            "ownership-filter": "auto"
          }
        }),
        true
      );
    },
    `export const config = {
  surfaceDefinitions: {
    home: { id: "home", enabled: true, requiresAuth: true, requiresWorkspace: false },
    admin: { id: "admin", enabled: true, requiresAuth: true, requiresWorkspace: true }
  }
};
`
  );
});

test("resolveCrudGenerationSurfaceId defaults home for non-workspace apps", async () => {
  await withTempApp(
    async (appRoot) => {
      assert.equal(
        await __testables.resolveCrudGenerationSurfaceId({
          appRoot,
          options: {
            namespace: "contacts"
          }
        }),
        "home"
      );
    },
    `export const config = {
  surfaceDefinitions: {
    home: { id: "home", enabled: true, requiresAuth: false, requiresWorkspace: false },
    console: { id: "console", enabled: true, requiresAuth: true, requiresWorkspace: false }
  }
};
`
  );
});

test("resolveCrudGenerationSurfaceId requires explicit surface for workspace-capable apps", async () => {
  await withTempApp(
    async (appRoot) => {
      await assert.rejects(
        __testables.resolveCrudGenerationSurfaceId({
          appRoot,
          options: {
            namespace: "contacts"
          }
        }),
        /requires option "surface"/
      );
    },
    `export const config = {
  surfaceDefinitions: {
    home: { id: "home", enabled: true, requiresAuth: false, requiresWorkspace: false },
    admin: { id: "admin", enabled: true, requiresAuth: true, requiresWorkspace: true }
  }
};
`
  );
});

test("buildReplacementsFromSnapshot omits default list ordering when created_at is absent", () => {
  const snapshot = createSnapshot({
    hasCreatedAtColumn: false
  });
  __testables.buildReplacementsFromSnapshot({
    namespace: "contacts",
    snapshot,
    resolvedOwnershipFilter: "workspace_user"
  });
});

test("buildReplacementsFromSnapshot renders inline field relation metadata from foreign keys", () => {
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
    namespace: "contacts",
    snapshot,
    resolvedOwnershipFilter: "workspace_user"
  });

  assert.match(replacements.__JSKIT_CRUD_RESOURCE_SCHEMA_PROPERTIES__, /vetId: \{/);
  assert.match(
    replacements.__JSKIT_CRUD_RESOURCE_SCHEMA_PROPERTIES__,
    /relation: \{ kind: "lookup", namespace: "customer-categories", valueKey: "id" \}.*belongsTo: "customerCategories".*as: "vet".*ui: \{ formControl: "autocomplete" \}/s
  );
  assert.match(replacements.__JSKIT_CRUD_MIGRATION_FOREIGN_KEY_LINES__, /table\.foreign\(\["vet_id"\]/);
});

test("buildReplacementsFromSnapshot renders inline enum field ui options as select controls", () => {
  const baseSnapshot = createSnapshot({
    hasWorkspaceIdColumn: false,
    hasUserIdColumn: false
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
    namespace: "contacts",
    snapshot,
    resolvedOwnershipFilter: "public"
  });

  assert.match(replacements.__JSKIT_CRUD_RESOURCE_SCHEMA_PROPERTIES__, /temperament: \{/);
  assert.match(replacements.__JSKIT_CRUD_RESOURCE_SCHEMA_PROPERTIES__, /ui: \{ formControl: "select"/);
  assert.match(replacements.__JSKIT_CRUD_RESOURCE_SCHEMA_PROPERTIES__, /options: \[/);
  assert.match(replacements.__JSKIT_CRUD_RESOURCE_SCHEMA_PROPERTIES__, /"value":"friendly_excitable"/);
  assert.match(replacements.__JSKIT_CRUD_RESOURCE_SCHEMA_PROPERTIES__, /"label":"Friendly Excitable"/);
});

test("renderMigrationColumnLine ignores SQL NULL string defaults", () => {
  const line = __testables.renderMigrationColumnLine(
    {
      name: "workspace_id",
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

test("renderMigrationColumnLine unwraps quoted string defaults", () => {
  const stringLine = __testables.renderMigrationColumnLine({
    name: "name",
    dataType: "varchar",
    columnType: "varchar(255)",
    typeKind: "string",
    nullable: false,
    hasDefault: true,
    defaultValue: "''",
    autoIncrement: false,
    unsigned: false,
    extra: "",
    maxLength: 255,
    numericPrecision: null,
    numericScale: null,
    datetimePrecision: null,
    characterSetName: "utf8mb4",
    collationName: "utf8mb4_general_ci",
    enumValues: []
  });
  const enumLine = __testables.renderMigrationColumnLine({
    name: "temperament",
    dataType: "enum",
    columnType: "enum('friendly','unknown')",
    typeKind: "string",
    nullable: false,
    hasDefault: true,
    defaultValue: "'unknown'",
    autoIncrement: false,
    unsigned: false,
    extra: "",
    maxLength: null,
    numericPrecision: null,
    numericScale: null,
    datetimePrecision: null,
    characterSetName: "utf8mb4",
    collationName: "utf8mb4_general_ci",
    enumValues: ["friendly", "unknown"]
  });

  assert.match(stringLine, /\.defaultTo\(""\)/);
  assert.match(enumLine, /\.defaultTo\("unknown"\)/);
});

test("renderMigrationColumnLine preserves datetime precision", () => {
  const line = __testables.renderMigrationColumnLine({
    name: "deleted_at",
    dataType: "datetime",
    columnType: "datetime(3)",
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
    datetimePrecision: 3,
    characterSetName: "",
    collationName: "",
    enumValues: []
  });

  assert.match(line, /table\.dateTime\("deleted_at", \{ precision: 3 \}\)/);
});

test("buildReplacementsFromSnapshot preserves custom collations, hash unique indexes, and check constraints", () => {
  const snapshot = createSnapshot({
    tableName: "services",
    hasWorkspaceIdColumn: true,
    hasUserIdColumn: false
  });
  const replacements = __testables.buildReplacementsFromSnapshot({
    namespace: "services",
    snapshot: {
      ...snapshot,
      columns: Object.freeze([
        snapshot.columns[0],
        snapshot.columns[1],
        Object.freeze({
          name: "settings_json",
          key: "settingsJson",
          dataType: "longtext",
          columnType: "longtext",
          typeKind: "string",
          nullable: true,
          hasDefault: false,
          defaultValue: null,
          autoIncrement: false,
          unsigned: false,
          extra: "",
          maxLength: null,
          numericPrecision: null,
          numericScale: null,
          datetimePrecision: null,
          characterSetName: "utf8mb4",
          collationName: "utf8mb4_bin",
          enumValues: Object.freeze([])
        })
      ]),
      indexes: Object.freeze([
        Object.freeze({
          name: "uq_services_workspace_settings",
          unique: true,
          indexType: "HASH",
          columns: Object.freeze(["workspace_id", "settings_json"])
        })
      ]),
      foreignKeys: Object.freeze([]),
      checkConstraints: Object.freeze([
        Object.freeze({
          name: "settings_json",
          clause: "json_valid(`settings_json`)"
        })
      ])
    },
    resolvedOwnershipFilter: "workspace"
  });

  assert.match(
    replacements.__JSKIT_CRUD_MIGRATION_COLUMN_LINES__,
    /table\.specificType\("settings_json", "longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"\)/
  );
  assert.match(
    replacements.__JSKIT_CRUD_MIGRATION_INDEX_LINES__,
    /storageEngineIndexType: "hash"/
  );
  assert.match(
    replacements.__JSKIT_CRUD_MIGRATION_CHECK_CONSTRAINT_LINES__,
    /ALTER TABLE `services` ADD CONSTRAINT `settings_json` CHECK \(json_valid\(`settings_json`\)\)/
  );
});

test("resolveScaffoldColumns derives canonical resource numeric bounds from check constraints", () => {
  const snapshot = createSnapshot({
    tableName: "batch_receivals",
    hasWorkspaceIdColumn: false,
    hasUserIdColumn: false
  });

  const inputWeightColumn = Object.freeze({
    name: "input_weight",
    key: "inputWeight",
    dataType: "decimal",
    columnType: "decimal(10,3)",
    typeKind: "number",
    nullable: false,
    hasDefault: false,
    defaultValue: null,
    autoIncrement: false,
    unsigned: false,
    extra: "",
    maxLength: null,
    numericPrecision: 10,
    numericScale: 3,
    datetimePrecision: null,
    characterSetName: "",
    collationName: "",
    enumValues: Object.freeze([])
  });

  const batchedDailySequenceColumn = Object.freeze({
    name: "batched_daily_sequence",
    key: "batchedDailySequence",
    dataType: "int",
    columnType: "int unsigned",
    typeKind: "integer",
    nullable: false,
    hasDefault: false,
    defaultValue: null,
    autoIncrement: false,
    unsigned: true,
    extra: "",
    maxLength: null,
    numericPrecision: 10,
    numericScale: 0,
    datetimePrecision: null,
    characterSetName: "",
    collationName: "",
    enumValues: Object.freeze([])
  });

  const moistureLevelColumn = Object.freeze({
    name: "moisture_level",
    key: "moistureLevel",
    dataType: "decimal",
    columnType: "decimal(5,2)",
    typeKind: "number",
    nullable: true,
    hasDefault: false,
    defaultValue: null,
    autoIncrement: false,
    unsigned: false,
    extra: "",
    maxLength: null,
    numericPrecision: 5,
    numericScale: 2,
    datetimePrecision: null,
    characterSetName: "",
    collationName: "",
    enumValues: Object.freeze([])
  });

  const severityColumn = Object.freeze({
    name: "severity",
    key: "severity",
    dataType: "tinyint",
    columnType: "tinyint unsigned",
    typeKind: "integer",
    nullable: true,
    hasDefault: false,
    defaultValue: null,
    autoIncrement: false,
    unsigned: true,
    extra: "",
    maxLength: null,
    numericPrecision: 3,
    numericScale: 0,
    datetimePrecision: null,
    characterSetName: "",
    collationName: "",
    enumValues: Object.freeze([])
  });

  const scaffoldColumns = __testables.resolveScaffoldColumns({
    ...snapshot,
    columns: Object.freeze([
      snapshot.columns[0],
      inputWeightColumn,
      batchedDailySequenceColumn,
      moistureLevelColumn,
      severityColumn
    ]),
    checkConstraints: Object.freeze([
      Object.freeze({
        name: "chk_batch_receivals_input_weight",
        clause: "`input_weight` > 0"
      }),
      Object.freeze({
        name: "chk_batches_batched_daily_sequence",
        clause: "`batched_daily_sequence` >= 1"
      }),
      Object.freeze({
        name: "chk_batches_moisture_level",
        clause: "`moisture_level` is null or `moisture_level` >= 0 and `moisture_level` <= 100"
      }),
      Object.freeze({
        name: "chk_pet_notes_severity",
        clause: "`severity` is null or `severity` between 1 and 10"
      })
    ])
  });

  const inputWeight = scaffoldColumns.find((column) => column.name === "input_weight");
  const batchedDailySequence = scaffoldColumns.find((column) => column.name === "batched_daily_sequence");
  const moistureLevel = scaffoldColumns.find((column) => column.name === "moisture_level");
  const severity = scaffoldColumns.find((column) => column.name === "severity");

  assert.match(
    __testables.renderCanonicalResourceFieldSchema(inputWeight),
    /type: "number".*min: 0.001.*required: true.*search: true.*create: \{ required: true \}/s
  );
  assert.match(
    __testables.renderCanonicalResourceFieldSchema(batchedDailySequence),
    /type: "integer".*min: 1.*required: true.*search: true.*create: \{ required: true \}/s
  );
  assert.match(
    __testables.renderCanonicalResourceFieldSchema(moistureLevel),
    /type: "number".*min: 0.*max: 100.*nullable: true.*search: true.*create: \{ required: false \}/s
  );
  assert.match(
    __testables.renderCanonicalResourceFieldSchema(severity),
    /type: "integer".*min: 1.*max: 10.*nullable: true.*search: true.*create: \{ required: false \}/s
  );
});

test("buildReplacementsFromSnapshot renders canonical nullable temporal fields without invalid date errors", () => {
  const snapshot = createSnapshot({
    hasWorkspaceIdColumn: false,
    hasUserIdColumn: false
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
    replacements.__JSKIT_CRUD_RESOURCE_SCHEMA_PROPERTIES__,
    /scheduledAt: \{[\s\S]*type: "dateTime",[\s\S]*nullable: true,[\s\S]*storage: \{ writeSerializer: "datetime-utc" \},[\s\S]*create: \{ required: false \}[\s\S]*\},/s
  );
  assert.match(
    replacements.__JSKIT_CRUD_RESOURCE_SCHEMA_PROPERTIES__,
    /birthDate: \{[\s\S]*type: "date",[\s\S]*nullable: true,[\s\S]*create: \{ required: false \}[\s\S]*\},/s
  );
  assert.match(
    replacements.__JSKIT_CRUD_RESOURCE_SCHEMA_PROPERTIES__,
    /preferredTime: \{[\s\S]*type: "time",[\s\S]*nullable: true,[\s\S]*create: \{ required: false \}[\s\S]*\},/s
  );
});

test("crud repository template defines a json-rest-api adapter over the injected internal host", async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const templatePath = path.resolve(testDirectory, "..", "templates", "src", "local-package", "server", "repository.js");
  const templateSource = await readFile(templatePath, "utf8");
  assert.doesNotMatch(templateSource, /from "@jskit-ai\/http-runtime\/shared";/);
  assert.match(templateSource, /const JSON_REST_SCOPE_NAME = __JSKIT_CRUD_JSONREST_SCOPE_NAME__;/);
  assert.match(templateSource, /returnNullWhenJsonRestResourceMissing/);
  assert.match(templateSource, /return api\.resources\.\$\{option:namespace\|camel\}\.query\(/);
  assert.match(templateSource, /return returnNullWhenJsonRestResourceMissing\(\(\) =>\s+api\.resources\.\$\{option:namespace\|camel\}\.get\(/s);
  assert.match(templateSource, /return api\.resources\.\$\{option:namespace\|camel\}\.post\(/);
  assert.match(templateSource, /return returnNullWhenJsonRestResourceMissing\(\(\) =>\s+api\.resources\.\$\{option:namespace\|camel\}\.patch\(/s);
  assert.match(templateSource, /return returnNullWhenJsonRestResourceMissing\(async \(\) => \{\s+await api\.resources\.\$\{option:namespace\|camel\}\.delete\(/s);
  assert.match(templateSource, /createJsonRestContext\(options\?\.context \|\| null\)/);
  assert.match(templateSource, /buildJsonRestQueryParams\(JSON_REST_SCOPE_NAME, query\)/);
  assert.match(templateSource, /createJsonApiInputRecord\(JSON_REST_SCOPE_NAME, payload/);
  assert.doesNotMatch(templateSource, /function toJsonRestContext\(context = null\)/);
  assert.doesNotMatch(templateSource, /function normalizeArrayInput\(value\)/);
  assert.doesNotMatch(templateSource, /function buildJsonRestQueryParams\(query = \{\}/);
  assert.doesNotMatch(templateSource, /function createJsonApiInputRecord\(attributes = \{\}/);
  assert.doesNotMatch(templateSource, /normalizeVisibilityContext/);
  assert.match(templateSource, /withTransaction,/);
  assert.match(templateSource, /return Object\.freeze\(\{/);
  assert.doesNotMatch(templateSource, /createCrudResourceRuntime|resourceRuntime\./);
});

test("crud provider template derives json-rest host options directly from the shared resource", async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const templatePath = path.resolve(testDirectory, "..", "templates", "src", "local-package", "server", "CrudProvider.js");
  const templateSource = await readFile(templatePath, "utf8");

  assert.match(templateSource, /import \{ createCrudJsonApiServiceEvents \} from "@jskit-ai\/crud-core\/server\/serviceEvents";/);
  assert.match(templateSource, /createJsonRestResourceScopeOptions/);
  assert.match(templateSource, /import \{ createService \} from "\.\/service\.js";/);
  assert.doesNotMatch(templateSource, /serviceEvents\s*\}\s*from "\.\/service\.js";/);
  assert.match(templateSource, /import \{ resource \} from "\.\.\/shared\/\$\{option:namespace\|singular\|camel\}Resource\.js";/);
  assert.doesNotMatch(templateSource, /normalizeRecordId/);
  assert.match(templateSource, /toDatabaseDateTimeUtc/);
  assert.doesNotMatch(templateSource, /register\$\{option:namespace\|pascal\}JsonRestResources/);
  assert.match(templateSource, /const baseServiceEvents = createCrudJsonApiServiceEvents\(CRUD_MODULE_CONFIG\.namespace\);/);
  assert.match(templateSource, /const serviceEvents = \{\s+\.\.\.baseServiceEvents\s+\};/s);
  assert.match(templateSource, /const api = app\.make\(INTERNAL_JSON_REST_API\);/);
  assert.match(templateSource, /await addResourceIfMissing\(\s*api,\s*__JSKIT_CRUD_JSONREST_SCOPE_NAME__,\s*createJsonRestResourceScopeOptions\(resource,/s);
});

test("crud actions and routes templates derive cursor validation and route contracts from the shared resource", async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const actionsTemplatePath = path.resolve(testDirectory, "..", "templates", "src", "local-package", "server", "actions.js");
  const registerRoutesTemplatePath = path.resolve(testDirectory, "..", "templates", "src", "local-package", "server", "registerRoutes.js");

  const actionsTemplateSource = await readFile(actionsTemplatePath, "utf8");
  const registerRoutesTemplateSource = await readFile(registerRoutesTemplatePath, "utf8");

  assert.match(actionsTemplateSource, /createCrudCursorPaginationQueryValidator/);
  assert.match(actionsTemplateSource, /import \{ resource \} from "\.\.\/shared\/\$\{option:namespace\|singular\|camel\}Resource\.js";/);
  assert.match(actionsTemplateSource, /const listCursorPaginationQueryValidator = createCrudCursorPaginationQueryValidator\(\{\s+orderBy: resource\.defaultSort\s+\}\);/s);
  assert.match(actionsTemplateSource, /__JSKIT_CRUD_ACTION_PERMISSION_SUPPORT__/);
  assert.match(actionsTemplateSource, /__JSKIT_CRUD_LIST_ACTION_PERMISSION__/);
  assert.match(actionsTemplateSource, /output: null,/);
  assert.doesNotMatch(actionsTemplateSource, /ACTIONS_REQUIRE_NAMED_PERMISSIONS/);
  assert.doesNotMatch(actionsTemplateSource, /createActionPermission/);
  assert.match(registerRoutesTemplateSource, /createCrudJsonApiRouteContracts/);
  assert.match(registerRoutesTemplateSource, /const \{\s+listRouteContract,\s+viewRouteContract,\s+createRouteContract,\s+updateRouteContract,\s+deleteRouteContract,\s+recordRouteParamsValidator\s+\} = createCrudJsonApiRouteContracts\(\{/s);
  assert.match(registerRoutesTemplateSource, /resource__JSKIT_CRUD_ROUTE_CONTRACTS_RESOURCE_ARGS__/);
  assert.doesNotMatch(registerRoutesTemplateSource, /wrapResponse/);
  assert.match(registerRoutesTemplateSource, /reply\.code\(204\)\.send\(response\);/);
  assert.doesNotMatch(registerRoutesTemplateSource, /withStandardErrorResponses/);
});

test("crud service template preserves JSON:API output and emits entity ids from resource documents", async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const templatePath = path.resolve(testDirectory, "..", "templates", "src", "local-package", "server", "service.js");
  const templateSource = await readFile(templatePath, "utf8");

  assert.doesNotMatch(templateSource, /crudNamespaceSupport/);
  assert.doesNotMatch(templateSource, /serviceEvents/);
  assert.doesNotMatch(templateSource, /recordChangedEventName/);
  assert.doesNotMatch(templateSource, /resolveJsonApiResultRecordId/);
  assert.doesNotMatch(templateSource, /entityId:/);
  assert.match(templateSource, /function return404IfNotFound\(document = null\) \{/);
  assert.match(templateSource, /throw new AppError\(404, "Document not found\."\);/);
  assert.match(templateSource, /function createService\(\{ \$\{option:namespace\|camel\}Repository \} = \{\}\)/);
  assert.match(templateSource, /throw new TypeError\("createService requires \$\{option:namespace\|camel\}Repository\."\);/);
  assert.match(templateSource, /returnJsonApiDocument/);
  assert.match(templateSource, /async function queryDocuments\(query = \{\}, options = \{\}\)/);
  assert.match(templateSource, /returnJsonApiDocument\(await \$\{option:namespace\|camel\}Repository\.queryDocuments\(query, \{/);
  assert.match(templateSource, /async function patchDocumentById\(recordId, payload = \{\}, options = \{\}\)/);
  assert.match(templateSource, /returnJsonApiDocument\(return404IfNotFound\(await \$\{option:namespace\|camel\}Repository\.patchDocumentById\(recordId, payload, \{/);
  assert.match(templateSource, /async function deleteDocumentById\(recordId, options = \{\}\)/);
  assert.match(templateSource, /return \$\{option:namespace\|camel\}Repository\.deleteDocumentById\(recordId, \{/);
  assert.doesNotMatch(templateSource, /return404IfNotFound\(await \$\{option:namespace\|camel\}Repository\.deleteDocumentById/);
  assert.match(templateSource, /return Object\.freeze\(\{/);
  assert.match(templateSource, /export \{ createService \};/);
});

test("crud generator renders time columns with html-time-compatible schemas", async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const templatePath = path.resolve(testDirectory, "..", "src", "server", "buildTemplateContext.js");
  const templateSource = await readFile(templatePath, "utf8");

  assert.match(
    templateSource,
    /type: "time"/
  );
  assert.doesNotMatch(templateSource, /HTML_TIME_STRING_SCHEMA|NULLABLE_HTML_TIME_STRING_SCHEMA/);
});

test("buildReplacementsFromSnapshot renders canonical nullable time fields", () => {
  const snapshot = createSnapshot({
    tableName: "opening_hours"
  });
  const timeColumn = Object.freeze({
    name: "from_time",
    key: "fromTime",
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
  });
  const replacements = __testables.buildReplacementsFromSnapshot({
    namespace: "opening-hours",
    snapshot: {
      ...snapshot,
      columns: Object.freeze([...snapshot.columns, timeColumn])
    },
    resolvedOwnershipFilter: "workspace_user"
  });

  assert.match(
    replacements.__JSKIT_CRUD_RESOURCE_SCHEMA_PROPERTIES__,
    /fromTime: \{[\s\S]*type: "time",[\s\S]*nullable: true,[\s\S]*output: \{ required: true \},[\s\S]*create: \{ required: false \},[\s\S]*patch: \{ required: false \}[\s\S]*\},/s
  );
});

test("buildReplacementsFromSnapshot renders canonical non-nullable time fields", () => {
  const snapshot = createSnapshot({
    tableName: "opening_hours"
  });
  const timeColumn = Object.freeze({
    name: "from_time",
    key: "fromTime",
    dataType: "time",
    columnType: "time",
    typeKind: "time",
    nullable: false,
    hasDefault: false,
    defaultValue: null,
    autoIncrement: false,
    unsigned: false,
    extra: "",
    maxLength: null,
    numericPrecision: null,
    numericScale: null,
    enumValues: Object.freeze([])
  });
  const replacements = __testables.buildReplacementsFromSnapshot({
    namespace: "opening-hours",
    snapshot: {
      ...snapshot,
      columns: Object.freeze([...snapshot.columns, timeColumn])
    },
    resolvedOwnershipFilter: "workspace_user"
  });

  assert.match(
    replacements.__JSKIT_CRUD_RESOURCE_SCHEMA_PROPERTIES__,
    /fromTime: \{[\s\S]*type: "time",[\s\S]*required: true,[\s\S]*output: \{ required: true \},[\s\S]*create: \{ required: true \},[\s\S]*patch: \{ required: false \}[\s\S]*\},/s
  );
});

test("crud provider template injects the shared internal json-rest-api host and registers local resources at boot", async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const templatePath = path.resolve(testDirectory, "..", "templates", "src", "local-package", "server", "CrudProvider.js");
  const templateSource = await readFile(templatePath, "utf8");

  assert.match(
    templateSource,
    /from "@jskit-ai\/json-rest-api-core\/server\/jsonRestApiHost";/
  );
  assert.match(
    templateSource,
    /const api = scope\.make\(INTERNAL_JSON_REST_API\);/
  );
  assert.match(templateSource, /return createRepository\(\{\s*api,\s*knex\s*\}\);/s);
  assert.match(templateSource, /await addResourceIfMissing\(\s*api,\s*__JSKIT_CRUD_JSONREST_SCOPE_NAME__,\s*createJsonRestResourceScopeOptions\(resource,/s);
  assert.doesNotMatch(templateSource, /register\$\{option:namespace\|pascal\}JsonRestResources/);
  assert.match(
    templateSource,
    /routeSurfaceRequiresWorkspace: crudPolicy\.surfaceDefinition\.requiresWorkspace === true,/
  );
  assert.doesNotMatch(templateSource, /createCrudLookup|lookup\.\$\{option:namespace\|snake\}/);
});
