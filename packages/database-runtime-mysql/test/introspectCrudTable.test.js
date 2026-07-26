import assert from "node:assert/strict";
import test from "node:test";

import { introspectCrudTableSnapshot } from "../src/shared/introspectCrudTable.js";

function createKnexRawDouble({
  schemaName = "appdb",
  tableCollation = "utf8mb4_general_ci",
  columns = [],
  primaryKeyColumns = [],
  indexes = [],
  foreignKeys = [],
  primaryKeysByTable = {},
  checkConstraints = []
} = {}) {
  const calls = [];

  const knex = {
    async raw(sql, bindings = []) {
      const normalizedSql = String(sql || "").toLowerCase();
      calls.push({
        sql: normalizedSql,
        bindings: Array.isArray(bindings) ? [...bindings] : []
      });

      if (normalizedSql.includes("select database() as schemaname")) {
        return [[{ schemaName }], []];
      }
      if (normalizedSql.includes("from information_schema.tables")) {
        return [[{ tableCollation }], []];
      }
      if (normalizedSql.includes("from information_schema.columns")) {
        return [[...columns], []];
      }
      if (normalizedSql.includes("information_schema.check_constraints")) {
        return [[...checkConstraints], []];
      }
      if (normalizedSql.includes("from information_schema.table_constraints")) {
        return [[...primaryKeyColumns], []];
      }
      if (
        normalizedSql.includes("from information_schema.statistics") &&
        normalizedSql.includes("s.index_name = 'primary'")
      ) {
        return [
          Object.entries(primaryKeysByTable).flatMap(([tableName, columnNames]) =>
            columnNames.map((columnName, index) => ({
              tableName,
              columnName,
              ordinalPosition: index + 1
            }))
          ),
          []
        ];
      }
      if (normalizedSql.includes("from information_schema.statistics")) {
        return [[...indexes], []];
      }
      if (normalizedSql.includes("from information_schema.referential_constraints")) {
        return [[...foreignKeys], []];
      }

      throw new Error(`Unexpected SQL in test double: ${normalizedSql}`);
    }
  };

  return {
    knex,
    calls
  };
}

test("introspectCrudTableSnapshot maps MySQL table metadata to normalized snapshot", async () => {
  const { knex } = createKnexRawDouble({
    columns: [
      {
        columnName: "id",
        dataType: "int",
        columnType: "int unsigned",
        isNullable: "NO",
        columnDefault: null,
        extra: "auto_increment",
        characterMaximumLength: null,
        characterSetName: null,
        collationName: null,
        numericPrecision: 10,
        numericScale: 0,
        datetimePrecision: null,
        ordinalPosition: 1
      },
      {
        columnName: "workspace_id",
        dataType: "int",
        columnType: "int unsigned",
        isNullable: "YES",
        columnDefault: "NULL",
        extra: "",
        characterMaximumLength: null,
        characterSetName: null,
        collationName: null,
        numericPrecision: 10,
        numericScale: 0,
        datetimePrecision: null,
        ordinalPosition: 2
      },
      {
        columnName: "user_id",
        dataType: "int",
        columnType: "int unsigned",
        isNullable: "YES",
        columnDefault: "NULL",
        extra: "",
        characterMaximumLength: null,
        characterSetName: null,
        collationName: null,
        numericPrecision: 10,
        numericScale: 0,
        datetimePrecision: null,
        ordinalPosition: 3
      },
      {
        columnName: "first_name",
        dataType: "varchar",
        columnType: "varchar(160)",
        isNullable: "NO",
        columnDefault: null,
        extra: "",
        characterMaximumLength: 160,
        characterSetName: "utf8mb4",
        collationName: "utf8mb4_general_ci",
        numericPrecision: null,
        numericScale: null,
        datetimePrecision: null,
        ordinalPosition: 4
      },
      {
        columnName: "vip",
        dataType: "tinyint",
        columnType: "tinyint(1)",
        isNullable: "NO",
        columnDefault: "0",
        extra: "",
        characterMaximumLength: null,
        characterSetName: null,
        collationName: null,
        numericPrecision: 3,
        numericScale: 0,
        datetimePrecision: null,
        ordinalPosition: 5
      },
      {
        columnName: "contact_tier",
        dataType: "enum",
        columnType: "enum('VIP','New')",
        isNullable: "NO",
        columnDefault: "VIP",
        extra: "",
        characterMaximumLength: null,
        characterSetName: "utf8mb4",
        collationName: "utf8mb4_general_ci",
        numericPrecision: null,
        numericScale: null,
        datetimePrecision: null,
        ordinalPosition: 6
      },
      {
        columnName: "updated_at",
        dataType: "datetime",
        columnType: "datetime(3)",
        isNullable: "NO",
        columnDefault: "CURRENT_TIMESTAMP(3)",
        extra: "DEFAULT_GENERATED on update CURRENT_TIMESTAMP(3)",
        characterMaximumLength: null,
        characterSetName: null,
        collationName: null,
        numericPrecision: null,
        numericScale: null,
        datetimePrecision: 3,
        ordinalPosition: 7
      },
      {
        columnName: "settings_json",
        dataType: "longtext",
        columnType: "longtext",
        isNullable: "YES",
        columnDefault: null,
        extra: "",
        characterMaximumLength: null,
        characterSetName: "utf8mb4",
        collationName: "utf8mb4_bin",
        numericPrecision: null,
        numericScale: null,
        datetimePrecision: null,
        ordinalPosition: 8
      }
    ],
    primaryKeyColumns: [{ columnName: "id" }],
    indexes: [
      {
        indexName: "idx_contacts_first_name",
        nonUnique: 1,
        columnName: "first_name",
        seqInIndex: 1
      },
      {
        indexName: "uq_contacts_vip",
        nonUnique: 0,
        columnName: "vip",
        seqInIndex: 1
      }
    ],
    foreignKeys: [
      {
        constraintName: "contacts_workspace_id_foreign",
        columnName: "workspace_id",
        referencedTableName: "workspaces",
        referencedColumnName: "id",
        ordinalPosition: 1,
        updateRule: "CASCADE",
        deleteRule: "SET NULL"
      }
    ],
    primaryKeysByTable: {
      contacts: ["id"],
      workspaces: ["id"]
    },
    checkConstraints: [
      {
        constraintName: "settings_json",
        checkClause: "json_valid(`settings_json`)"
      }
    ]
  });

  const snapshot = await introspectCrudTableSnapshot(knex, {
    tableName: "contacts",
    idColumn: "id"
  });

  assert.equal(snapshot.dialect, "mysql2");
  assert.equal(snapshot.tableName, "contacts");
  assert.equal(snapshot.tableCollation, "utf8mb4_general_ci");
  assert.equal(snapshot.idColumn, "id");
  assert.deepEqual(snapshot.primaryKeyColumns, ["id"]);
  assert.equal(snapshot.hasWorkspaceIdColumn, true);
  assert.equal(snapshot.hasUserIdColumn, true);

  const firstName = snapshot.columns.find((column) => column.name === "first_name");
  assert.ok(firstName);
  assert.equal(firstName.key, "firstName");
  assert.equal(firstName.typeKind, "string");
  assert.equal(firstName.maxLength, 160);

  const workspaceId = snapshot.columns.find((column) => column.name === "workspace_id");
  assert.ok(workspaceId);
  assert.equal(workspaceId.hasDefault, false);

  const vip = snapshot.columns.find((column) => column.name === "vip");
  assert.ok(vip);
  assert.equal(vip.typeKind, "boolean");
  assert.equal(vip.hasDefault, true);

  const contactTier = snapshot.columns.find((column) => column.name === "contact_tier");
  assert.ok(contactTier);
  assert.deepEqual(contactTier.enumValues, ["VIP", "New"]);

  const settingsJson = snapshot.columns.find((column) => column.name === "settings_json");
  assert.ok(settingsJson);
  assert.equal(settingsJson.characterSetName, "utf8mb4");
  assert.equal(settingsJson.collationName, "utf8mb4_bin");

  const updatedAt = snapshot.columns.find((column) => column.name === "updated_at");
  assert.deepEqual(updatedAt.defaultExpression, {
    kind: "current_timestamp",
    precision: 3
  });
  assert.deepEqual(updatedAt.onUpdateExpression, {
    kind: "current_timestamp",
    precision: 3
  });

  assert.deepEqual(snapshot.indexes, [
    {
      name: "idx_contacts_first_name",
      unique: false,
      indexType: "",
      columns: ["first_name"]
    },
    {
      name: "uq_contacts_vip",
      unique: true,
      indexType: "",
      columns: ["vip"]
    }
  ]);
  assert.deepEqual(snapshot.foreignKeys, [
    {
      name: "contacts_workspace_id_foreign",
      referencedTableName: "workspaces",
      updateRule: "CASCADE",
      deleteRule: "SET NULL",
      columns: [
        {
          name: "workspace_id",
          referencedName: "id"
        }
      ]
    }
  ]);
  assert.deepEqual(snapshot.checkConstraints, [
    {
      name: "settings_json",
      clause: "json_valid(`settings_json`)"
    }
  ]);
});

test("introspectCrudTableSnapshot rejects unsupported column types", async () => {
  const { knex } = createKnexRawDouble({
    columns: [
      {
        columnName: "id",
        dataType: "int",
        columnType: "int unsigned",
        isNullable: "NO",
        columnDefault: null,
        extra: "auto_increment",
        characterMaximumLength: null,
        characterSetName: null,
        collationName: null,
        numericPrecision: 10,
        numericScale: 0,
        datetimePrecision: null,
        ordinalPosition: 1
      },
      {
        columnName: "location",
        dataType: "point",
        columnType: "point",
        isNullable: "YES",
        columnDefault: null,
        extra: "",
        characterMaximumLength: null,
        characterSetName: null,
        collationName: null,
        numericPrecision: null,
        numericScale: null,
        datetimePrecision: null,
        ordinalPosition: 2
      }
    ],
    primaryKeyColumns: [{ columnName: "id" }]
  });

  await assert.rejects(
    () => introspectCrudTableSnapshot(knex, { tableName: "contacts" }),
    /Unsupported MySQL column type "point"/
  );
});

test("introspectCrudTableSnapshot rejects when primary key does not include id column", async () => {
  const { knex } = createKnexRawDouble({
    columns: [
      {
        columnName: "id",
        dataType: "int",
        columnType: "int unsigned",
        isNullable: "NO",
        columnDefault: null,
        extra: "auto_increment",
        characterMaximumLength: null,
        characterSetName: null,
        collationName: null,
        numericPrecision: 10,
        numericScale: 0,
        datetimePrecision: null,
        ordinalPosition: 1
      }
    ],
    primaryKeyColumns: [{ columnName: "other_id" }]
  });

  await assert.rejects(
    () => introspectCrudTableSnapshot(knex, { tableName: "contacts" }),
    /Primary key must include id column "id"/
  );
});

test("introspectCrudTableSnapshot classifies only allowlisted temporal defaults as SQL expressions", async () => {
  const { knex } = createKnexRawDouble({
    columns: [
      ...validIdColumns(),
      {
        columnName: "label",
        dataType: "varchar",
        columnType: "varchar(190)",
        isNullable: "NO",
        columnDefault: "CURRENT_TIMESTAMP(3)",
        extra: "",
        characterMaximumLength: 190,
        characterSetName: "utf8mb4",
        collationName: "utf8mb4_general_ci",
        ordinalPosition: 2
      },
      {
        columnName: "created_at",
        dataType: "datetime",
        columnType: "datetime",
        isNullable: "NO",
        columnDefault: "CURRENT_TIMESTAMP()",
        extra: "",
        datetimePrecision: 0,
        ordinalPosition: 3
      }
    ],
    primaryKeyColumns: [{ columnName: "id" }]
  });

  const snapshot = await introspectCrudTableSnapshot(knex, {
    tableName: "labels"
  });
  const label = snapshot.columns.find((column) => column.name === "label");

  assert.equal(label.defaultValue, "CURRENT_TIMESTAMP(3)");
  assert.equal(label.defaultExpression, null);
  assert.equal(label.onUpdateExpression, null);
  assert.deepEqual(
    snapshot.columns.find((column) => column.name === "created_at").defaultExpression,
    {
      kind: "current_timestamp",
      precision: null
    }
  );
});

function validIdColumns(extraColumns = []) {
  return [
    {
      columnName: "id",
      dataType: "bigint",
      columnType: "bigint unsigned",
      isNullable: "NO",
      columnDefault: null,
      extra: "auto_increment",
      numericPrecision: 20,
      numericScale: 0,
      ordinalPosition: 1
    },
    ...extraColumns
  ];
}

test("introspectCrudTableSnapshot rejects composite foreign keys", async () => {
  const { knex } = createKnexRawDouble({
    columns: validIdColumns([
      {
        columnName: "workspace_id",
        dataType: "bigint",
        columnType: "bigint unsigned",
        isNullable: "NO",
        extra: "",
        ordinalPosition: 2
      },
      {
        columnName: "parent_id",
        dataType: "bigint",
        columnType: "bigint unsigned",
        isNullable: "NO",
        extra: "",
        ordinalPosition: 3
      }
    ]),
    primaryKeyColumns: [{ columnName: "id" }],
    foreignKeys: [
      {
        constraintName: "items_parent_foreign",
        columnName: "workspace_id",
        referencedTableName: "parents",
        referencedColumnName: "workspace_id",
        ordinalPosition: 1
      },
      {
        constraintName: "items_parent_foreign",
        columnName: "parent_id",
        referencedTableName: "parents",
        referencedColumnName: "id",
        ordinalPosition: 2
      }
    ],
    primaryKeysByTable: {
      items: ["id"],
      parents: ["id"]
    }
  });

  await assert.rejects(
    () => introspectCrudTableSnapshot(knex, { tableName: "items" }),
    /supports only single-column foreign keys.*2 columns/
  );
});

test("introspectCrudTableSnapshot rejects foreign keys to non-primary business keys", async () => {
  const { knex } = createKnexRawDouble({
    columns: validIdColumns([
      {
        columnName: "workspace_slug",
        dataType: "varchar",
        columnType: "varchar(190)",
        isNullable: "NO",
        extra: "",
        ordinalPosition: 2
      }
    ]),
    primaryKeyColumns: [{ columnName: "id" }],
    foreignKeys: [
      {
        constraintName: "items_workspace_slug_foreign",
        columnName: "workspace_slug",
        referencedTableName: "workspaces",
        referencedColumnName: "slug",
        ordinalPosition: 1
      }
    ],
    primaryKeysByTable: {
      items: ["id"],
      workspaces: ["id"]
    }
  });

  await assert.rejects(
    () => introspectCrudTableSnapshot(knex, { tableName: "items" }),
    /must target the primary key "workspaces.id", not "workspaces.slug"/
  );
});

test("introspectCrudTableSnapshot rejects foreign keys to composite primary keys", async () => {
  const { knex } = createKnexRawDouble({
    columns: validIdColumns([
      {
        columnName: "parent_id",
        dataType: "bigint",
        columnType: "bigint unsigned",
        isNullable: "NO",
        extra: "",
        ordinalPosition: 2
      }
    ]),
    primaryKeyColumns: [{ columnName: "id" }],
    foreignKeys: [
      {
        constraintName: "items_parent_foreign",
        columnName: "parent_id",
        referencedTableName: "parents",
        referencedColumnName: "id",
        ordinalPosition: 1
      }
    ],
    primaryKeysByTable: {
      items: ["id"],
      parents: ["workspace_id", "id"]
    }
  });

  await assert.rejects(
    () => introspectCrudTableSnapshot(knex, { tableName: "items" }),
    /primary key is not single-column.*workspace_id, id/
  );
});
