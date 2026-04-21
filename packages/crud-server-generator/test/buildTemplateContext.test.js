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
  assert.equal(
    replacements.__JSKIT_CRUD_LIST_ACTION_INPUT_VALIDATOR__,
    "[workspaceSlugParamsValidator, listCursorPaginationQueryValidator, listSearchQueryValidator, listParentFilterQueryValidator, lookupIncludeQueryValidator]"
  );
  assert.equal(
    replacements.__JSKIT_CRUD_VIEW_ROUTE_PARAMS_VALIDATOR_LINE__,
    "      paramsValidator: [routeParamsValidator, recordIdParamsValidator],"
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
  assert.equal(replacements.__JSKIT_CRUD_RESOURCE_FIELD_META_PUSH_LINES__, "");
  assert.match(replacements.__JSKIT_CRUD_RESOURCE_OUTPUT_SCHEMA_PROPERTIES__, /updatedAt: Type\.String/);
  assert.match(
    replacements.__JSKIT_CRUD_RESOURCE_OUTPUT_SCHEMA_PROPERTIES__,
    /id: recordIdSchema,/
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
  assert.equal(
    replacements.__JSKIT_CRUD_CREATE_ACTION_INPUT_VALIDATOR__,
    "{ payload: resource.operations.create.bodyValidator }"
  );
  assert.equal(replacements.__JSKIT_CRUD_LIST_ROUTE_PARAMS_VALIDATOR_LINE__, "");
  assert.equal(
    replacements.__JSKIT_CRUD_VIEW_ROUTE_PARAMS_VALIDATOR_LINE__,
    "      paramsValidator: recordIdParamsValidator,"
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
    namespace: "contacts",
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

  assert.match(replacements.__JSKIT_CRUD_RESOURCE_FIELD_META_PUSH_LINES__, /key: "temperament"/);
  assert.match(replacements.__JSKIT_CRUD_RESOURCE_FIELD_META_PUSH_LINES__, /formControl: "select"/);
  assert.match(replacements.__JSKIT_CRUD_RESOURCE_FIELD_META_PUSH_LINES__, /options: \[/);
  assert.match(replacements.__JSKIT_CRUD_RESOURCE_FIELD_META_PUSH_LINES__, /"value": "friendly_excitable"/);
  assert.match(replacements.__JSKIT_CRUD_RESOURCE_FIELD_META_PUSH_LINES__, /"label": "Friendly Excitable"/);
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

test("resolveScaffoldColumns derives resource numeric bounds from check constraints", () => {
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

  const scaffoldColumns = __testables.resolveScaffoldColumns({
    ...snapshot,
    columns: Object.freeze([
      snapshot.columns[0],
      inputWeightColumn,
      batchedDailySequenceColumn,
      moistureLevelColumn
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
      })
    ])
  });

  const inputWeight = scaffoldColumns.find((column) => column.name === "input_weight");
  const batchedDailySequence = scaffoldColumns.find((column) => column.name === "batched_daily_sequence");
  const moistureLevel = scaffoldColumns.find((column) => column.name === "moisture_level");

  assert.equal(
    __testables.renderResourceFieldSchema(inputWeight),
    "Type.Number({ minimum: 0.001 })"
  );
  assert.equal(
    __testables.renderResourceFieldSchema(batchedDailySequence),
    "Type.Integer({ minimum: 1 })"
  );
  assert.equal(
    __testables.renderResourceFieldSchema(moistureLevel),
    "Type.Union([Type.Number({ minimum: 0, maximum: 100 }), Type.Null()])"
  );
});

test("buildReplacementsFromSnapshot normalizes nullable temporal inputs without invalid date errors", () => {
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
    /from "@jskit-ai\/crud-core\/server\/resourceRuntime";/
  );
  assert.match(templateSource, /import \{ LIST_CONFIG \} from "\.\/listConfig\.js";/);
  assert.match(templateSource, /const REPOSITORY_CONFIG = Object\.freeze\(\{/);
  assert.match(templateSource, /const resourceRuntime = createCrudResourceRuntime\(resource, knex, \{/);
  assert.match(templateSource, /\.\.\.options,/);
  assert.match(templateSource, /\.\.\.REPOSITORY_CONFIG/);
  assert.match(templateSource, /return resourceRuntime\.list\(query, callOptions\);/);
  assert.match(templateSource, /return resourceRuntime\.findById\(recordId, callOptions\);/);
  assert.match(templateSource, /return resourceRuntime\.listByIds\(ids, callOptions\);/);
  assert.match(templateSource, /return resourceRuntime\.listByForeignIds\(ids, foreignKey, callOptions\);/);
  assert.match(templateSource, /return resourceRuntime\.create\(payload, callOptions\);/);
  assert.match(templateSource, /return resourceRuntime\.updateById\(recordId, patch, callOptions\);/);
  assert.match(templateSource, /return resourceRuntime\.deleteById\(recordId, callOptions\);/);
  assert.match(templateSource, /async function listByForeignIds\(ids = \[\], foreignKey = "", callOptions = \{\}\) \{/);
  assert.match(templateSource, /withTransaction: resourceRuntime\.withTransaction/);
  assert.match(templateSource, /return Object\.freeze\(\{/);
  assert.doesNotMatch(templateSource, /crudRepositoryList/);
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
  assert.match(actionsTemplateSource, /__JSKIT_CRUD_ACTION_PERMISSION_SUPPORT__/);
  assert.match(actionsTemplateSource, /__JSKIT_CRUD_LIST_ACTION_PERMISSION__/);
  assert.doesNotMatch(actionsTemplateSource, /ACTIONS_REQUIRE_NAMED_PERMISSIONS/);
  assert.doesNotMatch(actionsTemplateSource, /createActionPermission/);
  assert.match(registerRoutesTemplateSource, /createCrudCursorPaginationQueryValidator/);
  assert.match(registerRoutesTemplateSource, /import \{ LIST_CONFIG \} from "\.\/listConfig\.js";/);
  assert.match(registerRoutesTemplateSource, /const listCursorPaginationQueryValidator = createCrudCursorPaginationQueryValidator\(LIST_CONFIG\);/);
  assert.match(listConfigTemplateSource, /const LIST_CONFIG = Object\.freeze\(\{/);
  assert.match(listConfigTemplateSource, /__JSKIT_CRUD_LIST_CONFIG_LINES__/);
});

test("crud service template defines explicit service methods over shared service primitives and preserves overridable default events", async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const templatePath = path.resolve(testDirectory, "..", "templates", "src", "local-package", "server", "service.js");
  const templateSource = await readFile(templatePath, "utf8");

  assert.match(
    templateSource,
    /from "@jskit-ai\/crud-core\/server\/serviceEvents";/
  );
  assert.match(
    templateSource,
    /from "@jskit-ai\/crud-core\/server\/serviceMethods";/
  );
  assert.match(templateSource, /const serviceRuntime = createCrudServiceRuntime\(resource,/);
  assert.match(templateSource, /const baseServiceEvents = createCrudServiceEvents\(resource,/);
  assert.match(templateSource, /const serviceEvents = Object\.freeze\(\{/);
  assert.match(templateSource, /createRecord: \[\.\.\.baseServiceEvents\.createRecord\],/);
  assert.match(templateSource, /function createService\(\{ \$\{option:namespace\|camel\}Repository, fieldAccess = DEFAULT_FIELD_ACCESS \} = \{\}\)/);
  assert.match(templateSource, /async function listRecords\(query = \{\}, options = \{\}\)/);
  assert.match(templateSource, /return crudServiceListRecords\(serviceRuntime, \$\{option:namespace\|camel\}Repository, fieldAccess, query, options\);/);
  assert.match(templateSource, /async function updateRecord\(recordId, payload = \{\}, options = \{\}\)/);
  assert.match(templateSource, /return crudServiceUpdateRecord\(serviceRuntime, \$\{option:namespace\|camel\}Repository, fieldAccess, recordId, payload, options\);/);
  assert.match(templateSource, /return Object\.freeze\(\{/);
});

test("crud generator renders time columns with html-time-compatible schemas", async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const templatePath = path.resolve(testDirectory, "..", "src", "server", "buildTemplateContext.js");
  const templateSource = await readFile(templatePath, "utf8");

  assert.match(
    templateSource,
    /NULLABLE_HTML_TIME_STRING_SCHEMA/
  );
  assert.match(
    templateSource,
    /HTML_TIME_STRING_SCHEMA/
  );
  assert.doesNotMatch(templateSource, /format: "time"/);
});

test("buildReplacementsFromSnapshot uses shared framework time schemas in generated resources", () => {
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
    replacements.__JSKIT_CRUD_RESOURCE_VALIDATORS_IMPORT__,
    /(^|\n)\s*NULLABLE_HTML_TIME_STRING_SCHEMA(,|\n)/m
  );
  assert.doesNotMatch(
    replacements.__JSKIT_CRUD_RESOURCE_VALIDATORS_IMPORT__,
    /(^|\n)\s*HTML_TIME_STRING_SCHEMA(,|\n)/m
  );
  assert.match(
    replacements.__JSKIT_CRUD_RESOURCE_OUTPUT_SCHEMA_PROPERTIES__,
    /fromTime: NULLABLE_HTML_TIME_STRING_SCHEMA/
  );
  assert.match(
    replacements.__JSKIT_CRUD_RESOURCE_CREATE_SCHEMA_PROPERTIES__,
    /fromTime: NULLABLE_HTML_TIME_STRING_SCHEMA/
  );
  assert.doesNotMatch(
    replacements.__JSKIT_CRUD_RESOURCE_OUTPUT_SCHEMA_PROPERTIES__,
    /Type\.String\(\{ pattern:/
  );
});

test("buildReplacementsFromSnapshot imports only the non-nullable time schema when nullable time fields are absent", () => {
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
    replacements.__JSKIT_CRUD_RESOURCE_VALIDATORS_IMPORT__,
    /(^|\n)\s*HTML_TIME_STRING_SCHEMA(,|\n)/m
  );
  assert.doesNotMatch(
    replacements.__JSKIT_CRUD_RESOURCE_VALIDATORS_IMPORT__,
    /(^|\n)\s*NULLABLE_HTML_TIME_STRING_SCHEMA(,|\n)/m
  );
  assert.match(
    replacements.__JSKIT_CRUD_RESOURCE_OUTPUT_SCHEMA_PROPERTIES__,
    /fromTime: HTML_TIME_STRING_SCHEMA/
  );
  assert.match(
    replacements.__JSKIT_CRUD_RESOURCE_CREATE_SCHEMA_PROPERTIES__,
    /fromTime: HTML_TIME_STRING_SCHEMA/
  );
});

test("buildReplacementsFromSnapshot only imports record-id validator helpers that the resource actually uses", () => {
  const snapshot = createSnapshot({
    tableName: "pollen_types",
    columns: [
      {
        name: "id",
        dataType: "bigint",
        columnType: "bigint unsigned",
        nullable: false,
        key: "id"
      },
      {
        name: "name",
        dataType: "varchar",
        columnType: "varchar(32)",
        nullable: false,
        maxLength: 32,
        key: "name"
      }
    ]
  });

  const replacements = __testables.buildReplacementsFromSnapshot({
    namespace: "pollen-types",
    snapshot,
    resolvedOwnershipFilter: "public"
  });

  assert.match(replacements.__JSKIT_CRUD_RESOURCE_VALIDATORS_IMPORT__, /recordIdSchema/);
  assert.doesNotMatch(replacements.__JSKIT_CRUD_RESOURCE_VALIDATORS_IMPORT__, /recordIdInputSchema/);
  assert.doesNotMatch(replacements.__JSKIT_CRUD_RESOURCE_VALIDATORS_IMPORT__, /nullableRecordIdSchema/);
  assert.doesNotMatch(replacements.__JSKIT_CRUD_RESOURCE_VALIDATORS_IMPORT__, /nullableRecordIdInputSchema/);
});

test("crud provider template uses shared lookup provider helpers instead of inline wiring", async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const templatePath = path.resolve(testDirectory, "..", "templates", "src", "local-package", "server", "CrudProvider.js");
  const templateSource = await readFile(templatePath, "utf8");

  assert.match(
    templateSource,
    /from "@jskit-ai\/crud-core\/server\/lookups";/
  );
  assert.match(templateSource, /resolveLookup: createCrudLookupResolver\(scope\)/);
  assert.match(
    templateSource,
    /return createCrudLookup\(scope\.make\("repository\.\$\{option:namespace\|snake\}"\), \{\s*ownershipFilter: crudPolicy\.ownershipFilter\s*\}\);/
  );
  assert.match(
    templateSource,
    /routeSurfaceRequiresWorkspace: crudPolicy\.surfaceDefinition\.requiresWorkspace === true,/
  );
  assert.doesNotMatch(templateSource, /normalizePathname\(relation\.apiPath\)/);
});
