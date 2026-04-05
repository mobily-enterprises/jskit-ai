import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LIST_LIMIT,
  normalizeCrudListLimit,
  requireCrudTableName,
  buildWritePayload,
  mapRecordRow,
  applyCrudListQueryFilters,
  resolveCrudIdColumn,
  buildRepositoryColumnMetadata,
  deriveRepositoryMappingFromResource
} from "../src/server/repositorySupport.js";

function createQueryDouble() {
  const calls = [];
  const whereQuery = {
    where(...args) {
      if (args.length === 1 && typeof args[0] === "function") {
        calls.push(["innerWhereCallback"]);
        args[0](whereQuery);
        return whereQuery;
      }
      calls.push(["innerWhere", ...args]);
      return whereQuery;
    },
    orWhere(...args) {
      if (args.length === 1 && typeof args[0] === "function") {
        calls.push(["innerOrWhereCallback"]);
        args[0](whereQuery);
        return whereQuery;
      }
      calls.push(["innerOrWhere", ...args]);
      return whereQuery;
    },
    whereNull(...args) {
      calls.push(["innerWhereNull", ...args]);
      return whereQuery;
    },
    orWhereNull(...args) {
      calls.push(["innerOrWhereNull", ...args]);
      return whereQuery;
    },
    whereNotNull(...args) {
      calls.push(["innerWhereNotNull", ...args]);
      return whereQuery;
    },
    orWhereNotNull(...args) {
      calls.push(["innerOrWhereNotNull", ...args]);
      return whereQuery;
    },
    whereRaw(...args) {
      calls.push(["innerWhereRaw", ...args]);
      return whereQuery;
    }
  };

  const query = {
    modify(callback) {
      calls.push(["modify"]);
      callback(query);
      return query;
    },
    where(...args) {
      if (args.length === 1 && typeof args[0] === "function") {
        calls.push(["whereGroup"]);
        args[0](whereQuery);
        return query;
      }

      calls.push(["where", ...args]);
      return query;
    }
  };

  return {
    query,
    calls
  };
}

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

test("applyCrudListQueryFilters applies search and cursor filters", () => {
  const { query, calls } = createQueryDouble();
  const result = applyCrudListQueryFilters(query, {
    idColumn: "id",
    cursor: "3",
    q: "ani",
    searchColumns: ["first_name", "last_name"]
  });

  assert.equal(result, query);
  assert.deepEqual(calls, [
    ["modify"],
    ["whereGroup"],
    ["innerWhere", "first_name", "like", "%ani%"],
    ["innerOrWhere", "last_name", "like", "%ani%"],
    ["where", "id", ">", 3]
  ]);
});

test("applyCrudListQueryFilters skips search and cursor when inputs are empty", () => {
  const { query, calls } = createQueryDouble();
  const result = applyCrudListQueryFilters(query, {
    cursor: 0,
    q: "  ",
    searchColumns: []
  });

  assert.equal(result, query);
  assert.deepEqual(calls, []);
});

test("applyCrudListQueryFilters can skip id cursor filtering for ordered lists", () => {
  const { query, calls } = createQueryDouble();
  const result = applyCrudListQueryFilters(query, {
    cursor: "9",
    applyCursor: false
  });

  assert.equal(result, query);
  assert.deepEqual(calls, []);
});

test("applyCrudListQueryFilters applies parent FK filters from allowed columns", () => {
  const { query, calls } = createQueryDouble();
  const result = applyCrudListQueryFilters(query, {
    parentFilters: {
      contactId: " 7 ",
      ignored: "x"
    },
    parentFilterColumns: {
      contactId: "contact_id"
    }
  });

  assert.equal(result, query);
  assert.deepEqual(calls, [
    ["where", "contact_id", "7"]
  ]);
});

test("applyCrudListQueryFilters throws for invalid query builders", () => {
  assert.throws(
    () => applyCrudListQueryFilters({}),
    /requires query builder/
  );
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
        dbColumn: "vet_id",
        relation: {
          kind: "lookup",
          namespace: "vets",
          valueKey: "id"
        }
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
  assert.deepEqual(mapping.listSearchColumns, ["first_name", "created_at"]);
  assert.deepEqual(mapping.parentFilterColumns, {
    vetId: "vet_id"
  });
});

test("deriveRepositoryMappingFromResource excludes runtime-only lookups output key from db mapping", () => {
  const resource = {
    operations: {
      view: {
        outputValidator: {
          schema: {
            type: "object",
            properties: {
              id: { type: "integer" },
              firstName: { type: "string" },
              lookups: { type: "object" }
            }
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
    },
    fieldMeta: []
  };

  const mapping = deriveRepositoryMappingFromResource(resource);
  assert.deepEqual(mapping.outputKeys, ["id", "firstName"]);
});

test("deriveRepositoryMappingFromResource excludes custom lookup output container key", () => {
  const resource = {
    contract: {
      lookup: {
        containerKey: "lookupData"
      }
    },
    operations: {
      view: {
        outputValidator: {
          schema: {
            type: "object",
            properties: {
              id: { type: "integer" },
              firstName: { type: "string" },
              lookupData: { type: "object" }
            }
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
    },
    fieldMeta: []
  };

  const mapping = deriveRepositoryMappingFromResource(resource);
  assert.deepEqual(mapping.outputKeys, ["id", "firstName"]);
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
