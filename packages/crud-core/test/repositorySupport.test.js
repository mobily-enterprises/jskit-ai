import test from "node:test";
import assert from "node:assert/strict";
import { createSchema } from "json-rest-schema";
import {
  DEFAULT_LIST_LIMIT,
  normalizeCrudListLimit,
  normalizeCrudListCursor,
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

function createOperationSchemaDefinition(structure = {}, mode = "replace") {
  return {
    schema: createSchema(structure),
    mode
  };
}

test("normalizeCrudListLimit enforces fallback and max", () => {
  assert.equal(normalizeCrudListLimit(null), DEFAULT_LIST_LIMIT);
  assert.equal(normalizeCrudListLimit("abc"), DEFAULT_LIST_LIMIT);
  assert.equal(normalizeCrudListLimit(0), DEFAULT_LIST_LIMIT);
  assert.equal(normalizeCrudListLimit(5), 5);
  assert.equal(normalizeCrudListLimit(200), 100);
});

test("normalizeCrudListCursor rejects malformed id cursors", () => {
  assert.equal(normalizeCrudListCursor("7"), "7");
  assert.equal(normalizeCrudListCursor(""), "");
  assert.throws(
    () => normalizeCrudListCursor("abc"),
    /Invalid cursor/
  );
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

test("mapRecordRow omits keys whose source column is absent", () => {
  const row = { some_column: 1 };
  const mapped = mapRecordRow(row, ["someKey", "virtualField"], {
    someKey: "some_column",
    virtualField: "virtual_field"
  });

  assert.deepEqual(mapped, {
    someKey: 1
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

test("buildWritePayload serializes configured date-time keys to database shape", () => {
  const payload = buildWritePayload(
    {
      scheduledAt: "2026-04-23T10:11:12.000Z",
      archivedAt: null,
      title: "Example"
    },
    ["scheduledAt", "archivedAt", "title"],
    {
      scheduledAt: "scheduled_at",
      archivedAt: "archived_at",
      title: "title"
    },
    {
      serializerByKey: {
        scheduledAt: "datetime-utc",
        archivedAt: "datetime-utc"
      }
    }
  );

  assert.deepEqual(payload, {
    scheduled_at: "2026-04-23 10:11:12.000",
    archived_at: null,
    title: "Example"
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
    ["where", "id", ">", "3"]
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

test("applyCrudListQueryFilters rejects malformed id cursors", () => {
  const { query } = createQueryDouble();
  assert.throws(
    () => applyCrudListQueryFilters(query, { cursor: "abc" }),
    /Invalid cursor/
  );
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
    columnOverrides: { lastName: "surname" },
    fieldStorageByKey: {
      firstName: "column",
      lastName: "column"
    }
  });

  assert.deepEqual(metadata.selectColumns, Object.freeze(["first_name", "surname"]));
  assert.equal(metadata.outputMappings.length, 2);
  assert.equal(metadata.writeMappings.length, 1);
  assert.equal(metadata.outputMappings[1].column, "surname");
});

test("deriveRepositoryMappingFromResource reads schema keys and repository column overrides", () => {
  const resource = {
    operations: {
      view: {
        output: createOperationSchemaDefinition({
          id: { type: "integer", required: true },
          firstName: { type: "string", required: true },
          createdAt: {
            type: "string",
            required: true,
            actualField: "created_at"
          }
        })
      },
      create: {
        body: createOperationSchemaDefinition({
          firstName: { type: "string" },
          vetId: {
            type: "integer",
            actualField: "vet_id",
            relation: {
              kind: "lookup",
              namespace: "vets",
              valueKey: "id"
            }
          }
        }, "create")
      },
      patch: {
        body: createOperationSchemaDefinition({
          archivedAt: {
            type: "string",
            actualField: "archived_at"
          },
          vetId: {
            type: "integer",
            actualField: "vet_id",
            relation: {
              kind: "lookup",
              namespace: "vets",
              valueKey: "id"
            }
          }
        }, "patch")
      }
    }
  };

  const mapping = deriveRepositoryMappingFromResource(resource);
  assert.deepEqual(mapping.outputKeys, ["id", "firstName", "createdAt"]);
  assert.deepEqual(mapping.writeKeys, ["firstName", "vetId", "archivedAt"]);
  assert.deepEqual(mapping.columnOverrides, {
    createdAt: "created_at",
    vetId: "vet_id",
    archivedAt: "archived_at"
  });
  assert.deepEqual(mapping.listSearchColumns, ["first_name", "created_at"]);
  assert.deepEqual(mapping.parentFilterColumns, {
    vetId: "vet_id"
  });
});

test("deriveRepositoryMappingFromResource treats virtual output fields as non-column projections", () => {
  const resource = {
    operations: {
      view: {
        output: createOperationSchemaDefinition({
          id: { type: "integer", required: true },
          firstName: { type: "string", required: true },
          remainingBatchWeight: {
            type: "number",
            storage: {
              virtual: true
            }
          }
        })
      },
      create: {
        body: createOperationSchemaDefinition({
          firstName: { type: "string" }
        }, "create")
      }
    }
  };

  const mapping = deriveRepositoryMappingFromResource(resource);
  assert.deepEqual(mapping.outputKeys, ["id", "firstName", "remainingBatchWeight"]);
  assert.deepEqual(mapping.columnBackedOutputKeys, ["id", "firstName"]);
  assert.deepEqual(mapping.virtualOutputKeys, ["remainingBatchWeight"]);
  assert.equal(mapping.fieldStorageByKey.remainingBatchWeight, "virtual");
  assert.deepEqual(mapping.listSearchColumns, ["first_name"]);
});

test("deriveRepositoryMappingFromResource rejects virtual fields in create schema", () => {
  const resource = {
    operations: {
      view: {
        output: createOperationSchemaDefinition({
          id: { type: "integer", required: true },
          remainingBatchWeight: {
            type: "number",
            storage: {
              virtual: true
            }
          }
        })
      },
      create: {
        body: createOperationSchemaDefinition({
          remainingBatchWeight: {
            type: "number",
            storage: {
              virtual: true
            }
          }
        }, "create")
      }
    }
  };

  assert.throws(
    () => deriveRepositoryMappingFromResource(resource),
    /resource create schema field "remainingBatchWeight" cannot use storage\.virtual/
  );
});

test("deriveRepositoryMappingFromResource rejects virtual fields in patch schema", () => {
  const resource = {
    operations: {
      view: {
        output: createOperationSchemaDefinition({
          id: { type: "integer", required: true },
          remainingBatchWeight: {
            type: "number",
            storage: {
              virtual: true
            }
          }
        })
      },
      create: {
        body: createOperationSchemaDefinition({}, "create")
      },
      patch: {
        body: createOperationSchemaDefinition({
          remainingBatchWeight: {
            type: "number",
            storage: {
              virtual: true
            }
          }
        }, "patch")
      }
    }
  };

  assert.throws(
    () => deriveRepositoryMappingFromResource(resource),
    /resource patch schema field "remainingBatchWeight" cannot use storage\.virtual/
  );
});

test("deriveRepositoryMappingFromResource excludes runtime-only lookups output key from db mapping", () => {
  const resource = {
    operations: {
      view: {
        output: createOperationSchemaDefinition({
          id: { type: "integer", required: true },
          firstName: { type: "string", required: true },
          lookups: { type: "object", opaque: true }
        })
      },
      create: {
        body: createOperationSchemaDefinition({
          firstName: { type: "string" }
        }, "create")
      }
    }
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
        output: createOperationSchemaDefinition({
          id: { type: "integer", required: true },
          firstName: { type: "string", required: true },
          lookupData: { type: "object", opaque: true }
        })
      },
      create: {
        body: createOperationSchemaDefinition({
          firstName: { type: "string" }
        }, "create")
      }
    }
  };

  const mapping = deriveRepositoryMappingFromResource(resource);
  assert.deepEqual(mapping.outputKeys, ["id", "firstName"]);
});

test("deriveRepositoryMappingFromResource rejects non-schema view output definitions", () => {
  const resource = {
    operations: {
      view: {
        output: {
          schema: {
            type: "object"
          }
        }
      },
      create: {
        body: createOperationSchemaDefinition({
          firstName: { type: "string" }
        }, "create")
      }
    }
  };

  assert.throws(
    () => deriveRepositoryMappingFromResource(resource),
    /operations\.view\.output\.schema must be a json-rest-schema schema instance/
  );
});

test("deriveRepositoryMappingFromResource rejects non-schema create body definitions", () => {
  const resource = {
    operations: {
      view: {
        output: createOperationSchemaDefinition({
          id: { type: "integer", required: true }
        })
      },
      create: {
        body: {
          schema: {
            type: "object"
          }
        }
      }
    }
  };

  assert.throws(
    () => deriveRepositoryMappingFromResource(resource),
    /operations\.create\.body\.schema must be a json-rest-schema schema instance/
  );
});

test("deriveRepositoryMappingFromResource tracks writable column-backed write serializers", () => {
  const resource = {
    operations: {
      view: {
        output: createOperationSchemaDefinition({
          id: { type: "integer", required: true },
          scheduledAt: { type: "dateTime", required: true },
          archivedAt: { type: "dateTime", required: true },
          remainingBatchWeight: {
            type: "number",
            storage: {
              virtual: true
            }
          }
        })
      },
      create: {
        body: createOperationSchemaDefinition({
          scheduledAt: { type: "dateTime" }
        }, "create")
      },
      patch: {
        body: createOperationSchemaDefinition({
          archivedAt: {
            type: "dateTime",
            nullable: true
          }
        }, "patch")
      }
    }
  };

  const mapping = deriveRepositoryMappingFromResource(resource);
  assert.deepEqual(mapping.writeSerializerByKey, {
    scheduledAt: "datetime-utc",
    archivedAt: "datetime-utc"
  });
});

test("deriveRepositoryMappingFromResource keeps explicit storage.writeSerializer metadata", () => {
  const resource = {
    operations: {
      view: {
        output: createOperationSchemaDefinition({
          id: { type: "integer", required: true },
          arrivalDatetime: {
            type: "dateTime",
            required: true,
            storage: {
              writeSerializer: "datetime-utc"
            }
          }
        })
      },
      create: {
        body: createOperationSchemaDefinition({
          arrivalDatetime: {
            type: "dateTime",
            storage: {
              writeSerializer: "datetime-utc"
            }
          }
        }, "create")
      }
    }
  };

  const mapping = deriveRepositoryMappingFromResource(resource);
  assert.deepEqual(mapping.writeSerializerByKey, {
    arrivalDatetime: "datetime-utc"
  });
});

test("deriveRepositoryMappingFromResource ignores transport export shape and uses authored field definitions", () => {
  const viewSchema = createSchema({
    recordId: {
      type: "id",
      required: true,
      actualField: "record_id"
    },
    title: {
      type: "string",
      required: true
    },
    scheduledAt: {
      type: "dateTime",
      required: true,
      actualField: "scheduled_at"
    }
  });
  const createInputSchema = createSchema({
    title: {
      type: "string",
      required: true
    },
    scheduledAt: {
      type: "dateTime",
      required: true,
      actualField: "scheduled_at"
    }
  });
  const patchInputSchema = createSchema({
    scheduledAt: {
      type: "dateTime",
      required: false,
      actualField: "scheduled_at"
    }
  });

  viewSchema.toJsonSchema = () => ({
    type: "object",
    properties: {
      title: {
        type: "number"
      },
      scheduledAt: {
        type: "string"
      }
    }
  });
  createInputSchema.toJsonSchema = () => ({
    type: "object",
    properties: {
      scheduledAt: {
        type: "string"
      }
    }
  });
  patchInputSchema.toJsonSchema = () => ({
    type: "object",
    properties: {}
  });

  const resource = {
    operations: {
      view: {
        output: {
          schema: viewSchema,
          mode: "replace"
        }
      },
      create: {
        body: {
          schema: createInputSchema,
          mode: "create"
        }
      },
      patch: {
        body: {
          schema: patchInputSchema,
          mode: "patch"
        }
      }
    }
  };

  const mapping = deriveRepositoryMappingFromResource(resource);
  assert.deepEqual(mapping.outputKeys, ["recordId", "title", "scheduledAt"]);
  assert.deepEqual(mapping.outputRecordIdKeys, ["recordId"]);
  assert.deepEqual(mapping.listSearchColumns, ["title"]);
  assert.deepEqual(mapping.writeSerializerByKey, {
    scheduledAt: "datetime-utc"
  });
  assert.deepEqual(mapping.columnOverrides, {
    recordId: "record_id",
    scheduledAt: "scheduled_at"
  });
});
