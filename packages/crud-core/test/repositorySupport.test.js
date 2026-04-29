import test from "node:test";
import assert from "node:assert/strict";
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
        output: {
          schema: {
            type: "object",
            properties: {
              id: { type: "integer" },
              firstName: { type: "string" },
              createdAt: {
                type: "string",
                actualField: "created_at"
              }
            }
          }
        }
      },
      create: {
        body: {
          schema: {
            type: "object",
            properties: {
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
            }
          }
        }
      },
      patch: {
        body: {
          schema: {
            type: "object",
            properties: {
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
            }
          }
        }
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
        output: {
          schema: {
            type: "object",
            properties: {
              id: { type: "integer" },
              firstName: { type: "string" },
              remainingBatchWeight: {
                type: "number",
                storage: {
                  virtual: true
                }
              }
            }
          }
        }
      },
      create: {
        body: {
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
        output: {
          schema: {
            type: "object",
            properties: {
              id: { type: "integer" },
              remainingBatchWeight: {
                type: "number",
                storage: {
                  virtual: true
                }
              }
            }
          }
        }
      },
      create: {
        body: {
          schema: {
            type: "object",
            properties: {
              remainingBatchWeight: {
                type: "number",
                storage: {
                  virtual: true
                }
              }
            }
          }
        }
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
        output: {
          schema: {
            type: "object",
            properties: {
              id: { type: "integer" },
              remainingBatchWeight: {
                type: "number",
                storage: {
                  virtual: true
                }
              }
            }
          }
        }
      },
      create: {
        body: {
          schema: {
            type: "object",
            properties: {}
          }
        }
      },
      patch: {
        body: {
          schema: {
            type: "object",
            properties: {
              remainingBatchWeight: {
                type: "number",
                storage: {
                  virtual: true
                }
              }
            }
          }
        }
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
        output: {
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
        body: {
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
        output: {
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
        body: {
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

  const mapping = deriveRepositoryMappingFromResource(resource);
  assert.deepEqual(mapping.outputKeys, ["id", "firstName"]);
});

test("deriveRepositoryMappingFromResource throws when view schema properties are missing", () => {
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
        body: {
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
    /operations\.view\.output\.schema\.properties/
  );
});

test("deriveRepositoryMappingFromResource throws when create schema properties are missing", () => {
  const resource = {
    operations: {
      view: {
        output: {
          schema: {
            type: "object",
            properties: {
              id: { type: "integer" }
            }
          }
        }
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
    /operations\.create\.body\.schema\.properties/
  );
});

test("deriveRepositoryMappingFromResource tracks writable column-backed write serializers", () => {
  const resource = {
    operations: {
      view: {
        output: {
          schema: {
            type: "object",
            properties: {
              id: { type: "integer" },
              scheduledAt: { type: "string", format: "date-time" },
              archivedAt: { type: "string", format: "date-time" },
              remainingBatchWeight: {
                type: "number",
                storage: {
                  virtual: true
                }
              }
            }
          }
        }
      },
      create: {
        body: {
          schema: {
            type: "object",
            properties: {
              scheduledAt: { type: "string", format: "date-time" }
            }
          }
        }
      },
      patch: {
        body: {
          schema: {
            type: "object",
            properties: {
              archivedAt: {
                anyOf: [
                  { type: "string", format: "date-time" },
                  { type: "null" }
                ]
              }
            }
          }
        }
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
        output: {
          schema: {
            type: "object",
            properties: {
              id: { type: "integer" },
              arrivalDatetime: {
                type: "string",
                format: "date-time",
                storage: {
                  writeSerializer: "datetime-utc"
                }
              }
            }
          }
        }
      },
      create: {
        body: {
          schema: {
            type: "object",
            properties: {
              arrivalDatetime: {
                type: "string",
                format: "date-time",
                storage: {
                  writeSerializer: "datetime-utc"
                }
              }
            }
          }
        }
      }
    }
  };

  const mapping = deriveRepositoryMappingFromResource(resource);
  assert.deepEqual(mapping.writeSerializerByKey, {
    arrivalDatetime: "datetime-utc"
  });
});
