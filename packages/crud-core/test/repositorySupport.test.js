import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LIST_LIMIT,
  normalizeCrudListLimit,
  requireCrudTableName,
  buildWritePayload,
  mapRecordRow,
  resolveCrudIdColumn,
  buildRepositoryColumnMetadata,
  deriveRepositoryMappingFromResource
} from "../src/server/repositorySupport.js";

test("normalizeCrudListLimit enforces fallback and max", () => {
  assert.equal(normalizeCrudListLimit(null), DEFAULT_LIST_LIMIT);
  assert.equal(normalizeCrudListLimit("abc"), DEFAULT_LIST_LIMIT);
  assert.equal(normalizeCrudListLimit(0), DEFAULT_LIST_LIMIT);
  assert.equal(normalizeCrudListLimit(5), 5);
  assert.equal(normalizeCrudListLimit(200), 100);
});

test("requireCrudTableName trims and rejects empty values", () => {
  assert.equal(requireCrudTableName("  crud_customers  "), "crud_customers");

  assert.throws(
    () => requireCrudTableName("   "),
    /requires tableName/
  );
});

test("mapRecordRow remaps rows by key/column pairs", () => {
  const row = { some_column: 1, other_column: 2 };
  const mapped = mapRecordRow(row, ["someKey", "otherKey"], {
    someKey: "some_column",
    otherKey: "other_column"
  });
  assert.deepEqual(mapped, {
    someKey: 1,
    otherKey: 2
  });
});

test("buildWritePayload respects defined keys", () => {
  const payload = buildWritePayload(
    { foo: "bar", missing: true },
    ["foo", "notPresent"],
    {
      foo: "foo_column",
      notPresent: "not_present_column"
    }
  );
  assert.deepEqual(payload, {
    foo_column: "bar"
  });
});

test("resolveCrudIdColumn falls back and rejects empties", () => {
  assert.equal(resolveCrudIdColumn("  custom_id  "), "custom_id");
  assert.equal(resolveCrudIdColumn(undefined, { fallback: "fallback_id" }), "fallback_id");
  assert.throws(() => resolveCrudIdColumn("", { fallback: "" }), /requires idColumn/);
});

test("buildRepositoryColumnMetadata normalizes columns and applies overrides", () => {
  const metadata = buildRepositoryColumnMetadata({
    outputKeys: ["firstName", "lastName"],
    writeKeys: ["firstName"],
    columnOverrides: { lastName: "surname" }
  });

  assert.deepEqual(metadata.selectColumns, Object.freeze(["first_name", "surname"]));
  assert.equal(metadata.outputMappings.length, 2);
  assert.equal(metadata.writeMappings.length, 1);
  assert.equal(metadata.outputMappings[1].column, "surname");
});

test("deriveRepositoryMappingFromResource reads schema keys and fieldMeta dbColumn overrides", () => {
  const resource = {
    operations: {
      view: {
        outputValidator: {
          schema: {
            type: "object",
            properties: {
              id: { type: "integer" },
              firstName: { type: "string" },
              createdAt: { type: "string" }
            }
          }
        }
      },
      create: {
        bodyValidator: {
          schema: {
            type: "object",
            properties: {
              firstName: { type: "string" },
              vetId: { type: "integer" }
            }
          }
        }
      }
    },
    fieldMeta: [
      {
        key: "createdAt",
        dbColumn: "created_at"
      },
      {
        key: "vetId",
        dbColumn: "vet_id"
      }
    ]
  };

  const mapping = deriveRepositoryMappingFromResource(resource);
  assert.deepEqual(mapping.outputKeys, ["id", "firstName", "createdAt"]);
  assert.deepEqual(mapping.writeKeys, ["firstName", "vetId"]);
  assert.deepEqual(mapping.columnOverrides, {
    createdAt: "created_at",
    vetId: "vet_id"
  });
});

test("deriveRepositoryMappingFromResource throws when view schema properties are missing", () => {
  const resource = {
    operations: {
      view: {
        outputValidator: {
          schema: {
            type: "object"
          }
        }
      },
      create: {
        bodyValidator: {
          schema: {
            type: "object",
            properties: {
              firstName: { type: "string" }
            }
          }
        }
      }
    }
  };

  assert.throws(
    () => deriveRepositoryMappingFromResource(resource),
    /operations\.view\.outputValidator\.schema\.properties/
  );
});

test("deriveRepositoryMappingFromResource throws when create schema properties are missing", () => {
  const resource = {
    operations: {
      view: {
        outputValidator: {
          schema: {
            type: "object",
            properties: {
              id: { type: "integer" }
            }
          }
        }
      },
      create: {
        bodyValidator: {
          schema: {
            type: "object"
          }
        }
      }
    }
  };

  assert.throws(
    () => deriveRepositoryMappingFromResource(resource),
    /operations\.create\.bodyValidator\.schema\.properties/
  );
});
