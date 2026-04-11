import assert from "node:assert/strict";
import test from "node:test";

import { introspectCrudTableSnapshot } from "../src/shared/introspectCrudTable.js";

function createKnexRawDouble({
  schemaName = "appdb",
  columns = [],
  primaryKeyColumns = [],
  indexes = [],
  foreignKeys = []
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
      if (normalizedSql.includes("from information_schema.columns")) {
        return [[...columns], []];
      }
      if (normalizedSql.includes("from information_schema.table_constraints")) {
        return [[...primaryKeyColumns], []];
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
        numericPrecision: null,
        numericScale: null,
        datetimePrecision: null,
        ordinalPosition: 6
      },
      {
        columnName: "updated_at",
        dataType: "datetime",
        columnType: "datetime",
        isNullable: "NO",
        columnDefault: "CURRENT_TIMESTAMP",
        extra: "",
        characterMaximumLength: null,
        numericPrecision: null,
        numericScale: null,
        datetimePrecision: 0,
        ordinalPosition: 7
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
    ]
  });

  const snapshot = await introspectCrudTableSnapshot(knex, {
    tableName: "contacts",
    idColumn: "id"
  });

  assert.equal(snapshot.dialect, "mysql2");
  assert.equal(snapshot.tableName, "contacts");
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

  assert.deepEqual(snapshot.indexes, [
    {
      name: "idx_contacts_first_name",
      unique: false,
      columns: ["first_name"]
    },
    {
      name: "uq_contacts_vip",
      unique: true,
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
