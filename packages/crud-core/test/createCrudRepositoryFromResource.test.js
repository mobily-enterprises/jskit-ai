import test from "node:test";
import assert from "node:assert/strict";
import { createCrudRepositoryFromResource } from "../src/server/createCrudRepositoryFromResource.js";

function createListKnexDouble(
  rows = [],
  {
    insertResult = [1],
    updateResult = 1,
    deleteResult = 1
  } = {}
) {
  const calls = [];
  const state = {
    rows: Array.isArray(rows) ? rows : [],
    insertPayloads: [],
    updatePayloads: [],
    deleteCount: 0
  };

  function createQueryBuilder() {
    let firstMode = false;
    const whereGroup = {
      where(...args) {
        if (args.length === 1 && typeof args[0] === "function") {
          calls.push(["innerWhereCallback"]);
          args[0](whereGroup);
          return whereGroup;
        }
        calls.push(["where", ...args]);
        return whereGroup;
      },
      orWhere(...args) {
        if (args.length === 1 && typeof args[0] === "function") {
          calls.push(["innerOrWhereCallback"]);
          args[0](whereGroup);
          return whereGroup;
        }
        calls.push(["orWhere", ...args]);
        return whereGroup;
      },
      whereNull(...args) {
        calls.push(["whereNull", ...args]);
        return whereGroup;
      },
      orWhereNull(...args) {
        calls.push(["orWhereNull", ...args]);
        return whereGroup;
      },
      whereNotNull(...args) {
        calls.push(["whereNotNull", ...args]);
        return whereGroup;
      },
      orWhereNotNull(...args) {
        calls.push(["orWhereNotNull", ...args]);
        return whereGroup;
      },
      whereRaw(...args) {
        calls.push(["whereRaw", ...args]);
        return whereGroup;
      }
    };

    const query = {
      select(...args) {
        calls.push(["select", ...args]);
        return query;
      },
      where(...args) {
        if (args.length === 1 && typeof args[0] === "function") {
          calls.push(["whereCallback"]);
          args[0](whereGroup);
          return query;
        }
        calls.push(["where", ...args]);
        return query;
      },
      orWhere(...args) {
        if (args.length === 1 && typeof args[0] === "function") {
          calls.push(["orWhereCallback"]);
          args[0](whereGroup);
          return query;
        }
        calls.push(["orWhere", ...args]);
        return query;
      },
      whereNull(...args) {
        calls.push(["whereNull", ...args]);
        return query;
      },
      orWhereNull(...args) {
        calls.push(["orWhereNull", ...args]);
        return query;
      },
      whereNotNull(...args) {
        calls.push(["whereNotNull", ...args]);
        return query;
      },
      orWhereNotNull(...args) {
        calls.push(["orWhereNotNull", ...args]);
        return query;
      },
      whereRaw(...args) {
        calls.push(["whereRaw", ...args]);
        return query;
      },
      orderBy(...args) {
        calls.push(["orderBy", ...args]);
        return query;
      },
      orderByRaw(...args) {
        calls.push(["orderByRaw", ...args]);
        return query;
      },
      clearOrder() {
        calls.push(["clearOrder"]);
        return query;
      },
      clear(...args) {
        calls.push(["clear", ...args]);
        return query;
      },
      limit(value) {
        calls.push(["limit", value]);
        return query;
      },
      modify(callback) {
        calls.push(["modify"]);
        callback(query);
        return query;
      },
      whereIn(...args) {
        calls.push(["whereIn", ...args]);
        return query;
      },
      first() {
        calls.push(["first"]);
        firstMode = true;
        return query;
      },
      insert(payload) {
        calls.push(["insert", payload]);
        state.insertPayloads.push(payload);
        return Promise.resolve(insertResult);
      },
      update(payload) {
        calls.push(["update", payload]);
        state.updatePayloads.push(payload);
        return Promise.resolve(updateResult);
      },
      delete() {
        calls.push(["delete"]);
        state.deleteCount += 1;
        return Promise.resolve(deleteResult);
      },
      then(resolve, reject) {
        const payload = firstMode ? state.rows[0] || null : state.rows;
        return Promise.resolve(payload).then(resolve, reject);
      }
    };

    return query;
  }

  const knex = (tableName) => {
    calls.push(["table", tableName]);
    return createQueryBuilder();
  };

  return {
    knex,
    calls,
    state
  };
}

function createResourceFixture() {
  return {
    resource: "contacts",
    tableName: "contacts_table",
    idColumn: "contact_id",
    operations: {
      view: {
        outputValidator: {
          schema: {
            type: "object",
            properties: {
              id: { type: "integer" },
              firstName: { type: "string" }
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
    fieldMeta: [
      {
        key: "id",
        dbColumn: "contact_id"
      }
    ]
  };
}

function createLookupResourceFixture() {
  return {
    resource: "contacts",
    tableName: "contacts_table",
    idColumn: "contact_id",
    operations: {
      view: {
        outputValidator: {
          schema: {
            type: "object",
            properties: {
              id: { type: "integer" },
              firstName: { type: "string" },
              primaryVetId: { type: "integer" },
              secondaryVetId: { type: ["integer", "null"] },
              lookups: {
                type: "object"
              }
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
              primaryVetId: { type: "integer" },
              secondaryVetId: { type: "integer" }
            }
          }
        }
      }
    },
    fieldMeta: [
      {
        key: "id",
        dbColumn: "contact_id"
      },
      {
        key: "primaryVetId",
        dbColumn: "primary_vet_id",
        relation: {
          kind: "lookup",
          namespace: "vets",
          valueKey: "id"
        }
      },
      {
        key: "secondaryVetId",
        dbColumn: "secondary_vet_id",
        relation: {
          kind: "lookup",
          namespace: "vets",
          valueKey: "id"
        }
      }
    ]
  };
}

function createLookupResourceWithCustomContainerKeyFixture() {
  return {
    resource: "contacts",
    tableName: "contacts_table",
    idColumn: "contact_id",
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
              primaryVetId: { type: "integer" },
              secondaryVetId: { type: "integer" },
              lookupData: {
                type: "object"
              }
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
              primaryVetId: { type: "integer" },
              secondaryVetId: { type: "integer" }
            }
          }
        }
      }
    },
    fieldMeta: [
      {
        key: "id",
        dbColumn: "contact_id"
      },
      {
        key: "primaryVetId",
        dbColumn: "primary_vet_id",
        relation: {
          kind: "lookup",
          namespace: "vets",
          valueKey: "id"
        }
      },
      {
        key: "secondaryVetId",
        dbColumn: "secondary_vet_id",
        relation: {
          kind: "lookup",
          namespace: "vets",
          valueKey: "id"
        }
      }
    ]
  };
}

function createCollectionLookupResourceFixture() {
  return {
    resource: "contacts",
    tableName: "contacts_table",
    idColumn: "contact_id",
    operations: {
      view: {
        outputValidator: {
          schema: {
            type: "object",
            properties: {
              id: { type: "integer" },
              firstName: { type: "string" },
              lookups: {
                type: "object"
              }
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
    fieldMeta: [
      {
        key: "id",
        dbColumn: "contact_id"
      },
      {
        key: "pets",
        relation: {
          kind: "collection",
          namespace: "pets",
          foreignKey: "customerId",
          parentValueKey: "id"
        }
      }
    ]
  };
}

function createPetsLookupBackToContactsResourceFixture() {
  return {
    resource: "pets",
    tableName: "pets_table",
    idColumn: "pet_id",
    operations: {
      view: {
        outputValidator: {
          schema: {
            type: "object",
            properties: {
              id: { type: "integer" },
              name: { type: "string" },
              customerId: { type: "integer" },
              lookups: {
                type: "object"
              }
            }
          }
        }
      },
      create: {
        bodyValidator: {
          schema: {
            type: "object",
            properties: {
              name: { type: "string" }
            }
          }
        }
      }
    },
    fieldMeta: [
      {
        key: "id",
        dbColumn: "pet_id"
      },
      {
        key: "customerId",
        dbColumn: "customer_id",
        relation: {
          kind: "lookup",
          namespace: "contacts",
          valueKey: "id"
        }
      }
    ]
  };
}

function createNormalizedResourceFixture() {
  return {
    resource: "contacts",
    tableName: "contacts_table",
    idColumn: "contact_id",
    operations: {
      view: {
        outputValidator: {
          schema: {
            type: "object",
            properties: {
              id: { type: "integer" },
              firstName: { type: "string" }
            },
            required: ["id", "firstName"]
          },
          normalize(payload = {}) {
            return {
              id: Number(payload.id),
              firstName: String(payload.firstName || "").trim()
            };
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
    fieldMeta: [
      {
        key: "id",
        dbColumn: "contact_id"
      }
    ]
  };
}

function createWritableHookResourceFixture() {
  return {
    resource: "contacts",
    tableName: "contacts_table",
    idColumn: "contact_id",
    operations: {
      view: {
        outputValidator: {
          schema: {
            type: "object",
            properties: {
              id: { type: "integer" },
              firstName: { type: "string" },
              createdAt: { type: "string" },
              updatedAt: { type: "string" }
            },
            required: ["id", "firstName", "createdAt", "updatedAt"]
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
    fieldMeta: [
      {
        key: "id",
        dbColumn: "contact_id"
      },
      {
        key: "firstName",
        dbColumn: "first_name"
      },
      {
        key: "createdAt",
        dbColumn: "created_at"
      },
      {
        key: "updatedAt",
        dbColumn: "updated_at"
      }
    ]
  };
}

test("createCrudRepositoryFromResource requires table metadata from resource", () => {
  assert.throws(
    () =>
      createCrudRepositoryFromResource({
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
                type: "object",
                properties: {}
              }
            }
          }
        },
        fieldMeta: []
      }),
    /requires resource\.tableName or resource\.resource/
  );
});

test("createCrudRepositoryFromResource defaults table and id columns from resource", async () => {
  const createRepository = createCrudRepositoryFromResource(createResourceFixture());
  const { knex, calls } = createListKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony"
    }
  ]);
  const repository = createRepository(knex);

  const result = await repository.list({
    cursor: 2,
    q: "to"
  });

  assert.deepEqual(result, {
    items: [
      {
        id: 3,
        firstName: "Tony"
      }
    ],
    nextCursor: null
  });
  assert.equal(calls[0][1], "contacts_table");
  assert.ok(calls.some((call) => call[0] === "where" && call[1] === "contact_id" && call[2] === ">" && call[3] === 2));
});

test("createCrudRepositoryFromResource createRepository requires knex", () => {
  const createRepository = createCrudRepositoryFromResource(createResourceFixture());
  assert.throws(
    () => createRepository(null),
    /requires knex/
  );
});

test("createCrudRepositoryFromResource allows list tuning through list config", async () => {
  const createRepository = createCrudRepositoryFromResource(createResourceFixture(), {
    list: {
      defaultLimit: 1,
      maxLimit: 2,
      searchColumns: ["first_name"]
    }
  });
  const { knex, calls } = createListKnexDouble([
    { contact_id: 3, first_name: "Tony" },
    { contact_id: 4, first_name: "Tom" },
    { contact_id: 5, first_name: "Toby" }
  ]);
  const repository = createRepository(knex);

  await repository.list({
    q: "to",
    limit: 99
  });

  assert.ok(calls.some((call) => call[0] === "where" && call[1] === "first_name" && call[2] === "like" && call[3] === "%to%"));
  assert.ok(calls.some((call) => call[0] === "limit" && call[1] === 3));
});

test("createCrudRepositoryFromResource supports declarative ordered list pagination", async () => {
  const createRepository = createCrudRepositoryFromResource(createResourceFixture(), {
    list: {
      defaultLimit: 2,
      orderBy: [
        { column: "created_at", direction: "desc" }
      ]
    }
  });
  const rows = [
    { contact_id: 9, first_name: "Tina", created_at: "2026-04-05T10:00:00.000Z" },
    { contact_id: 7, first_name: "Tony", created_at: "2026-04-04T09:00:00.000Z" },
    { contact_id: 6, first_name: "Tom", created_at: "2026-04-03T08:00:00.000Z" }
  ];
  const { knex, calls } = createListKnexDouble(rows);
  const repository = createRepository(knex);

  const result = await repository.list();

  assert.deepEqual(result, {
    items: [
      { id: 9, firstName: "Tina" },
      { id: 7, firstName: "Tony" }
    ],
    nextCursor: Buffer.from(
      JSON.stringify({ values: ["2026-04-04T09:00:00.000Z", 7] }),
      "utf8"
    ).toString("base64url")
  });
  assert.ok(calls.some((call) => call[0] === "orderByRaw" && call[1] === "?? is null asc" && call[2]?.[0] === "created_at"));
  assert.ok(calls.some((call) => call[0] === "orderBy" && call[1] === "created_at" && call[2] === "desc"));
  assert.ok(calls.some((call) => call[0] === "orderBy" && call[1] === "contact_id" && call[2] === "desc"));
});

test("createCrudRepositoryFromResource applies ordered cursors using the configured sort tuple", async () => {
  const createRepository = createCrudRepositoryFromResource(createResourceFixture(), {
    list: {
      orderBy: [
        { column: "created_at", direction: "desc" }
      ]
    }
  });
  const { knex, calls } = createListKnexDouble([
    { contact_id: 6, first_name: "Tom", created_at: "2026-04-03T08:00:00.000Z" }
  ]);
  const repository = createRepository(knex);
  const cursor = Buffer.from(
    JSON.stringify({ values: ["2026-04-04T09:00:00.000Z", 7] }),
    "utf8"
  ).toString("base64url");

  await repository.list({
    cursor,
    limit: 2
  });

  assert.ok(calls.some((call) => call[0] === "where" && call[1] === "created_at" && call[2] === "<" && call[3] === "2026-04-04T09:00:00.000Z"));
  assert.ok(calls.some((call) => call[0] === "where" && call[1] === "created_at" && call[2] === "2026-04-04T09:00:00.000Z"));
  assert.ok(calls.some((call) => call[0] === "where" && call[1] === "contact_id" && call[2] === "<" && call[3] === 7));
  assert.ok(!calls.some((call) => call[0] === "where" && call[1] === "contact_id" && call[2] === ">" && call[3] === 7));
});

test("createCrudRepositoryFromResource rejects malformed ordered cursors", async () => {
  const createRepository = createCrudRepositoryFromResource(createResourceFixture(), {
    list: {
      orderBy: [
        { column: "created_at", direction: "desc" }
      ]
    }
  });
  const { knex } = createListKnexDouble([]);
  const repository = createRepository(knex);

  await assert.rejects(
    () => repository.list({
      cursor: "not-a-real-cursor",
      limit: 2
    }),
    /Invalid cursor/
  );
});

test("createCrudRepositoryFromResource preserves Date cursor values for datetime sort columns", async () => {
  const createRepository = createCrudRepositoryFromResource(createResourceFixture(), {
    list: {
      defaultLimit: 2,
      orderBy: [
        { column: "created_at", direction: "desc" }
      ]
    }
  });
  const createdAt = new Date("2026-04-04T09:00:00.000Z");
  const olderCreatedAt = new Date("2026-04-03T08:00:00.000Z");
  const { knex, calls } = createListKnexDouble([
    { contact_id: 9, first_name: "Tina", created_at: createdAt },
    { contact_id: 7, first_name: "Tony", created_at: createdAt },
    { contact_id: 6, first_name: "Tom", created_at: olderCreatedAt }
  ]);
  const repository = createRepository(knex);

  const first = await repository.list();
  const firstCallCount = calls.length;

  await repository.list({
    cursor: first.nextCursor,
    limit: 2
  });

  const secondCallEntries = calls.slice(firstCallCount);
  const afterCall = secondCallEntries.find((call) => (
    call[0] === "where" &&
    call[1] === "created_at" &&
    call[2] === "<"
  ));
  const equalityCall = secondCallEntries.find((call) => (
    call[0] === "where" &&
    call[1] === "created_at" &&
    call[2] instanceof Date
  ));

  assert.ok(first.nextCursor);
  assert.ok(afterCall);
  assert.ok(afterCall[3] instanceof Date);
  assert.equal(afterCall[3].toISOString(), createdAt.toISOString());
  assert.ok(equalityCall);
  assert.equal(equalityCall[2].toISOString(), createdAt.toISOString());
});

test("createCrudRepositoryFromResource ordered cursors handle null primary sort values", async () => {
  const createRepository = createCrudRepositoryFromResource(createResourceFixture(), {
    list: {
      orderBy: [
        { column: "created_at", direction: "desc" }
      ]
    }
  });
  const { knex, calls } = createListKnexDouble([
    { contact_id: 6, first_name: "Tom", created_at: null }
  ]);
  const repository = createRepository(knex);
  const cursor = Buffer.from(
    JSON.stringify({ values: [null, 7] }),
    "utf8"
  ).toString("base64url");

  await repository.list({
    cursor,
    limit: 2
  });

  assert.ok(calls.some((call) => call[0] === "whereNull" && call[1] === "created_at"));
  assert.ok(calls.some((call) => call[0] === "where" && call[1] === "contact_id" && call[2] === "<" && call[3] === 7));
  assert.ok(!calls.some((call) => call[0] === "whereNotNull" && call[1] === "created_at"));
});

test("createCrudRepositoryFromResource keeps ordered cursor prefix grouping for multi-column sorts", async () => {
  const createRepository = createCrudRepositoryFromResource(createResourceFixture(), {
    list: {
      orderBy: [
        { column: "created_at", direction: "desc" },
        { column: "last_name", direction: "desc" }
      ]
    }
  });
  const { knex, calls } = createListKnexDouble([
    {
      contact_id: 6,
      first_name: "Tom",
      last_name: "Taylor",
      created_at: "2026-04-03T08:00:00.000Z"
    }
  ]);
  const repository = createRepository(knex);
  const cursor = Buffer.from(
    JSON.stringify({ values: ["2026-04-04T09:00:00.000Z", "Taylor", 7] }),
    "utf8"
  ).toString("base64url");

  await repository.list({
    cursor,
    limit: 2
  });

  const createdAtEqualityIndex = calls.findIndex((call) => (
    call[0] === "where" &&
    call[1] === "created_at" &&
    call[2] === "2026-04-04T09:00:00.000Z"
  ));
  const nestedGroupIndex = calls.findIndex((call, index) => (
    index > createdAtEqualityIndex &&
    call[0] === "innerWhereCallback"
  ));
  const lastNameAfterIndex = calls.findIndex((call, index) => (
    index > nestedGroupIndex &&
    call[0] === "where" &&
    call[1] === "last_name" &&
    call[2] === "<" &&
    call[3] === "Taylor"
  ));
  const lastNameEqualityIndex = calls.findIndex((call, index) => (
    index > lastNameAfterIndex &&
    call[0] === "where" &&
    call[1] === "last_name" &&
    call[2] === "Taylor"
  ));
  const idAfterIndex = calls.findIndex((call, index) => (
    index > lastNameEqualityIndex &&
    call[0] === "where" &&
    call[1] === "contact_id" &&
    call[2] === "<" &&
    call[3] === 7
  ));

  assert.ok(createdAtEqualityIndex >= 0);
  assert.ok(nestedGroupIndex > createdAtEqualityIndex);
  assert.ok(lastNameAfterIndex > nestedGroupIndex);
  assert.ok(lastNameEqualityIndex > lastNameAfterIndex);
  assert.ok(idAfterIndex > lastNameEqualityIndex);
});

test("createCrudRepositoryFromResource exposes listByIds for lookup providers", async () => {
  const createRepository = createCrudRepositoryFromResource(createResourceFixture());
  const { knex, calls } = createListKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony"
    }
  ]);
  const repository = createRepository(knex);

  const records = await repository.listByIds([3, 3, 4]);

  assert.equal(records.length, 1);
  assert.deepEqual(records[0], {
    id: 3,
    firstName: "Tony"
  });
  assert.ok(calls.some((call) => call[0] === "whereIn" && call[1] === "contact_id"));
});

test("createCrudRepositoryFromResource exposes listByForeignIds for arbitrary output keys", async () => {
  const createRepository = createCrudRepositoryFromResource(createResourceFixture());
  const { knex, calls } = createListKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony"
    }
  ]);
  const repository = createRepository(knex);

  const records = await repository.listByForeignIds(["Tony"], "firstName");

  assert.equal(records.length, 1);
  assert.deepEqual(records[0], {
    id: 3,
    firstName: "Tony"
  });
  assert.ok(calls.some((call) => call[0] === "whereIn" && call[1] === "first_name"));
});

test("createCrudRepositoryFromResource listByForeignIds requires a foreignKey", async () => {
  const createRepository = createCrudRepositoryFromResource(createResourceFixture());
  const { knex } = createListKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony"
    }
  ]);
  const repository = createRepository(knex);

  await assert.rejects(
    () => repository.listByForeignIds([3], ""),
    /listByForeignIds requires foreignKey/
  );
});

test("createCrudRepositoryFromResource listByIds fails fast when valueKey is not in output schema", async () => {
  const createRepository = createCrudRepositoryFromResource(createResourceFixture());
  const { knex } = createListKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony"
    }
  ]);
  const repository = createRepository(knex);

  await assert.rejects(
    () =>
      repository.listByIds([3], {
        valueKey: "externalCustomerId"
      }),
    /valueKey "externalCustomerId" to exist in output schema/
  );
});

test("createCrudRepositoryFromResource normalizes listByIds output using resource view output validator", async () => {
  const createRepository = createCrudRepositoryFromResource(createNormalizedResourceFixture());
  const { knex } = createListKnexDouble([
    {
      contact_id: "3",
      first_name: " Tony "
    }
  ]);
  const repository = createRepository(knex);

  const result = await repository.listByIds([3]);
  assert.deepEqual(result, [
    {
      id: 3,
      firstName: "Tony"
    }
  ]);
});

test("createCrudRepositoryFromResource fails when mapped output violates resource view output schema", async () => {
  const createRepository = createCrudRepositoryFromResource(createResourceFixture());
  const { knex } = createListKnexDouble([
    {
      contact_id: "3",
      first_name: "Tony"
    }
  ]);
  const repository = createRepository(knex);

  await assert.rejects(
    () => repository.listByIds([3]),
    /output validation failed/
  );
});

test("createCrudRepositoryFromResource hydrates lookup relations by default and batches by lookup resource", async () => {
  const createRepository = createCrudRepositoryFromResource(createLookupResourceFixture());
  const { knex } = createListKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony",
      primary_vet_id: 10,
      secondary_vet_id: 12
    },
    {
      contact_id: 4,
      first_name: "Sara",
      primary_vet_id: 10,
      secondary_vet_id: null
    }
  ]);

  const lookupCalls = [];
  const repository = createRepository(knex, {
    resolveLookupProvider(relation = {}) {
      assert.equal(relation.namespace, "vets");
      return {
        async listByIds(ids = [], options = {}) {
          lookupCalls.push({
            ids,
            options
          });
          return [
            { id: 10, name: "Vet A" },
            { id: 12, name: "Vet B" }
          ];
        }
      };
    }
  });

  const result = await repository.list({});

  assert.equal(lookupCalls.length, 1);
  assert.deepEqual(lookupCalls[0].ids, [10, 12]);
  assert.equal(lookupCalls[0].options.include, "*");
  assert.equal(lookupCalls[0].options.lookupDepth, 1);
  assert.equal(lookupCalls[0].options.lookupMaxDepth, 3);
  assert.deepEqual(result.items[0].lookups, {
    primaryVetId: { id: 10, name: "Vet A" },
    secondaryVetId: { id: 12, name: "Vet B" }
  });
  assert.deepEqual(result.items[1].lookups, {
    primaryVetId: { id: 10, name: "Vet A" },
    secondaryVetId: null
  });
});

test("createCrudRepositoryFromResource writes hydrated lookups into custom output container key", async () => {
  const createRepository = createCrudRepositoryFromResource(createLookupResourceWithCustomContainerKeyFixture());
  const { knex } = createListKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony",
      primary_vet_id: 10,
      secondary_vet_id: 12
    }
  ]);
  const repository = createRepository(knex, {
    resolveLookupProvider() {
      return {
        async listByIds() {
          return [
            { id: 10, name: "Vet A" },
            { id: 12, name: "Vet B" }
          ];
        }
      };
    }
  });

  const result = await repository.list({});
  assert.equal(Object.hasOwn(result.items[0], "lookups"), false);
  assert.deepEqual(result.items[0].lookupData, {
    primaryVetId: { id: 10, name: "Vet A" },
    secondaryVetId: { id: 12, name: "Vet B" }
  });
});

test("createCrudRepositoryFromResource respects resource lookup.defaultInclude=none", async () => {
  const resource = createLookupResourceFixture();
  resource.contract = {
    lookup: {
      defaultInclude: "none"
    }
  };
  const createRepository = createCrudRepositoryFromResource(resource);
  const { knex } = createListKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony",
      primary_vet_id: 10,
      secondary_vet_id: 12
    }
  ]);

  let resolverCalls = 0;
  const repository = createRepository(knex, {
    resolveLookupProvider() {
      resolverCalls += 1;
      return {
        async listByIds() {
          return [];
        }
      };
    }
  });

  const result = await repository.list({});
  assert.equal(resolverCalls, 0);
  assert.equal(Object.hasOwn(result.items[0], "lookups"), false);
});

test("createCrudRepositoryFromResource skips lookup hydration when include=none", async () => {
  const createRepository = createCrudRepositoryFromResource(createLookupResourceFixture());
  const { knex } = createListKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony",
      primary_vet_id: 10,
      secondary_vet_id: 12
    }
  ]);
  const repository = createRepository(knex);

  const result = await repository.list({
    include: "none"
  });

  assert.equal(result.items.length, 1);
  assert.equal(Object.hasOwn(result.items[0], "lookups"), false);
});

test("createCrudRepositoryFromResource forwards nested include paths to child lookup repositories", async () => {
  const createRepository = createCrudRepositoryFromResource(createLookupResourceFixture());
  const { knex } = createListKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony",
      primary_vet_id: 10,
      secondary_vet_id: 12
    }
  ]);

  const lookupCalls = [];
  const repository = createRepository(knex, {
    resolveLookupProvider() {
      return {
        async listByIds(ids = [], options = {}) {
          lookupCalls.push({
            ids,
            options
          });
          return [{ id: 10, name: "Vet A" }, { id: 12, name: "Vet B" }];
        }
      };
    }
  });

  await repository.list({
    include: "primaryVetId.vetTypeId"
  });

  assert.equal(lookupCalls.length, 1);
  assert.equal(lookupCalls[0].options.include, "vetTypeId");
});

test("createCrudRepositoryFromResource forwards wildcard nested include paths to child lookup repositories", async () => {
  const createRepository = createCrudRepositoryFromResource(createLookupResourceFixture());
  const { knex } = createListKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony",
      primary_vet_id: 10,
      secondary_vet_id: 12
    }
  ]);

  const lookupCalls = [];
  const repository = createRepository(knex, {
    resolveLookupProvider() {
      return {
        async listByIds(ids = [], options = {}) {
          lookupCalls.push({
            ids,
            options
          });
          return [{ id: 10, name: "Vet A" }, { id: 12, name: "Vet B" }];
        }
      };
    }
  });

  await repository.list({
    include: "primaryVetId.*"
  });

  assert.equal(lookupCalls.length, 1);
  assert.equal(lookupCalls[0].options.include, "*");
});

test("createCrudRepositoryFromResource remaps child lookup visibility for public child providers", async () => {
  const createRepository = createCrudRepositoryFromResource(createLookupResourceFixture());
  const { knex } = createListKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony",
      primary_vet_id: 10,
      secondary_vet_id: 12
    }
  ]);

  const lookupCalls = [];
  const repository = createRepository(knex, {
    resolveLookupProvider() {
      return {
        ownershipFilter: "public",
        async listByIds(ids = [], options = {}) {
          lookupCalls.push({
            ids,
            options
          });
          return [{ id: 10, name: "Vet A" }, { id: 12, name: "Vet B" }];
        }
      };
    }
  });

  await repository.list({}, {
    visibilityContext: {
      visibility: "workspace",
      scopeOwnerId: "workspace-1"
    }
  });

  assert.equal(lookupCalls.length, 1);
  assert.deepEqual(lookupCalls[0].options.visibilityContext, {
    visibility: "public"
  });
});

test("createCrudRepositoryFromResource remaps child lookup visibility for workspace child providers", async () => {
  const createRepository = createCrudRepositoryFromResource(createLookupResourceFixture());
  const { knex } = createListKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony",
      primary_vet_id: 10,
      secondary_vet_id: 12
    }
  ]);

  const lookupCalls = [];
  const repository = createRepository(knex, {
    resolveLookupProvider() {
      return {
        ownershipFilter: "workspace",
        async listByIds(ids = [], options = {}) {
          lookupCalls.push({
            ids,
            options
          });
          return [{ id: 10, name: "Vet A" }, { id: 12, name: "Vet B" }];
        }
      };
    }
  });

  await repository.list({}, {
    visibilityContext: {
      visibility: "workspace_user",
      scopeOwnerId: "workspace-1",
      userId: "user-1"
    }
  });

  assert.equal(lookupCalls.length, 1);
  assert.deepEqual(lookupCalls[0].options.visibilityContext, {
    visibility: "workspace",
    scopeOwnerId: "workspace-1"
  });
});

test("createCrudRepositoryFromResource requires child lookup ownershipFilter under non-public visibility", async () => {
  const createRepository = createCrudRepositoryFromResource(createLookupResourceFixture());
  const { knex } = createListKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony",
      primary_vet_id: 10,
      secondary_vet_id: 12
    }
  ]);
  const repository = createRepository(knex, {
    resolveLookupProvider() {
      return {
        async listByIds() {
          return [];
        }
      };
    }
  });

  await assert.rejects(
    () =>
      repository.list({}, {
        visibilityContext: {
          visibility: "workspace",
          scopeOwnerId: "workspace-1"
        }
      }),
    /must declare ownershipFilter/
  );
});

test("createCrudRepositoryFromResource hydrates collection relations through listByIds valueKey", async () => {
  const createRepository = createCrudRepositoryFromResource(createCollectionLookupResourceFixture());
  const { knex } = createListKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony"
    },
    {
      contact_id: 4,
      first_name: "Sara"
    }
  ]);

  const lookupCalls = [];
  const repository = createRepository(knex, {
    resolveLookupProvider(relation = {}) {
      assert.equal(relation.namespace, "pets");
      return {
        async listByIds(ids = [], options = {}) {
          lookupCalls.push({
            ids,
            options
          });
          return [
            { id: 11, name: "Milo", customerId: 3 },
            { id: 12, name: "Luna", customerId: 3 },
            { id: 20, name: "Ruby", customerId: 4 }
          ];
        }
      };
    }
  });

  const result = await repository.list({
    include: "pets"
  });

  assert.equal(lookupCalls.length, 1);
  assert.deepEqual(lookupCalls[0].ids, [3, 4]);
  assert.equal(lookupCalls[0].options.include, "none");
  assert.equal(lookupCalls[0].options.valueKey, "customerId");
  assert.deepEqual(result.items[0].lookups?.pets?.map((item) => item.name), ["Milo", "Luna"]);
  assert.deepEqual(result.items[1].lookups?.pets?.map((item) => item.name), ["Ruby"]);
});

test("createCrudRepositoryFromResource blocks recursive lookup hydration across collection back-references", async () => {
  const createContactsRepository = createCrudRepositoryFromResource(createCollectionLookupResourceFixture());
  const createPetsRepository = createCrudRepositoryFromResource(createPetsLookupBackToContactsResourceFixture());
  const { knex: contactsKnex } = createListKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony"
    }
  ]);
  const { knex: petsKnex } = createListKnexDouble([
    {
      pet_id: 11,
      name: "Milo",
      customer_id: 3
    }
  ]);

  let contactsRepository = null;
  let petsRepository = null;
  let contactsLookupCallCount = 0;
  let receivedPetsLookupOptions = null;

  petsRepository = createPetsRepository(petsKnex, {
    resolveLookupProvider(relation = {}) {
      if (relation.namespace !== "contacts") {
        throw new Error(`unexpected relation namespace: ${relation.namespace}`);
      }
      contactsLookupCallCount += 1;
      return contactsRepository;
    }
  });

  contactsRepository = createContactsRepository(contactsKnex, {
    resolveLookupProvider(relation = {}) {
      if (relation.namespace !== "pets") {
        throw new Error(`unexpected relation namespace: ${relation.namespace}`);
      }
      return {
        async listByIds(ids = [], options = {}) {
          receivedPetsLookupOptions = options;
          return petsRepository.listByIds(ids, options);
        }
      };
    }
  });

  const result = await contactsRepository.list({
    include: "pets.*"
  });

  assert.equal(contactsLookupCallCount, 0);
  assert.deepEqual(result.items[0].lookups?.pets?.map((item) => item.name), ["Milo"]);
  assert.ok(Array.isArray(receivedPetsLookupOptions?.lookupVisitedNamespaces));
  assert.ok(receivedPetsLookupOptions.lookupVisitedNamespaces.includes("contacts"));
});

test("createCrudRepositoryFromResource forwards configured lookup maxDepth to child repositories", async () => {
  const resource = createLookupResourceFixture();
  resource.contract = {
    lookup: {
      maxDepth: 5
    }
  };
  const createRepository = createCrudRepositoryFromResource(resource);
  const { knex } = createListKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony",
      primary_vet_id: 10,
      secondary_vet_id: 12
    }
  ]);

  const lookupCalls = [];
  const repository = createRepository(knex, {
    resolveLookupProvider() {
      return {
        async listByIds(ids = [], options = {}) {
          lookupCalls.push({
            ids,
            options
          });
          return [{ id: 10, name: "Vet A" }, { id: 12, name: "Vet B" }];
        }
      };
    }
  });

  await repository.list({});
  assert.equal(lookupCalls.length, 1);
  assert.equal(lookupCalls[0].options.lookupMaxDepth, 5);
});

test("createCrudRepositoryFromResource throws when include requires lookups and resolver is missing", async () => {
  const createRepository = createCrudRepositoryFromResource(createLookupResourceFixture());
  const { knex } = createListKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony",
      primary_vet_id: 10,
      secondary_vet_id: 12
    }
  ]);
  const repository = createRepository(knex);

  await assert.rejects(
    () => repository.list({}),
    /requires resolveLookupProvider/
  );
});

test("createCrudRepositoryFromResource throws when include references unknown lookup field", async () => {
  const createRepository = createCrudRepositoryFromResource(createLookupResourceFixture());
  const { knex } = createListKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony",
      primary_vet_id: 10,
      secondary_vet_id: 12
    }
  ]);
  const repository = createRepository(knex, {
    resolveLookupProvider() {
      return {
        async listByIds() {
          return [];
        }
      };
    }
  });

  await assert.rejects(
    () => repository.list({ include: "unknownLookupKey" }),
    /unknown lookup key/
  );
});

test("createCrudRepositoryFromResource list hooks reject invalid types and unsupported keys", async () => {
  const createRepository = createCrudRepositoryFromResource(createResourceFixture());
  const { knex } = createListKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony"
    }
  ]);
  const repository = createRepository(knex);

  await assert.rejects(
    () => repository.list({}, {}, {
      modifyQuery: "not-a-function"
    }),
    /hooks\.modifyQuery must be a function/
  );

  await assert.rejects(
    () => repository.list({}, {}, {
      unsupported() {}
    }),
    /does not support hooks\.unsupported/
  );
});

test("createCrudRepositoryFromResource list hooks cannot replace query builders", async () => {
  const createRepository = createCrudRepositoryFromResource(createResourceFixture());
  const { knex } = createListKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony"
    }
  ]);
  const repository = createRepository(knex);

  await assert.rejects(
    () => repository.list({}, {}, {
      modifyQuery() {
        return {
          where() {}
        };
      }
    }),
    /must mutate the provided query builder/
  );
});

test("createCrudRepositoryFromResource list hooks share state across afterQuery/transformReturnedRecord/finalizeOutput", async () => {
  const createRepository = createCrudRepositoryFromResource(createResourceFixture());
  const { knex } = createListKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony"
    },
    {
      contact_id: 4,
      first_name: "Sam"
    }
  ]);
  const repository = createRepository(knex);

  const result = await repository.list({}, {}, {
    afterQuery(items = [], context = {}) {
      const labels = {};
      for (const item of items) {
        labels[item.id] = `contact-${item.id}`;
      }
      context.state.labels = labels;
    },
    transformReturnedRecord(record = {}, context = {}) {
      return {
        ...record,
        label: context.state.labels?.[record.id] || null
      };
    },
    finalizeOutput(resultPayload = {}) {
      return {
        ...resultPayload,
        itemCount: Array.isArray(resultPayload.items) ? resultPayload.items.length : 0
      };
    }
  });

  assert.equal(result.itemCount, 2);
  assert.deepEqual(result.items.map((item) => item.label), ["contact-3", "contact-4"]);
});

test("createCrudRepositoryFromResource list finalizeOutput requires canonical result keys", async () => {
  const createRepository = createCrudRepositoryFromResource(createResourceFixture());
  const { knex } = createListKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony"
    }
  ]);
  const repository = createRepository(knex);

  await assert.rejects(
    () => repository.list({}, {}, {
      finalizeOutput() {
        return {
          items: []
        };
      }
    }),
    /required key "nextCursor"/
  );
});

test("createCrudRepositoryFromResource list hooks reject async return values that replace builder identity", async () => {
  const createRepository = createCrudRepositoryFromResource(createResourceFixture());
  const { knex } = createListKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony"
    }
  ]);
  const repository = createRepository(knex);

  await assert.rejects(
    () => repository.list({}, {}, {
      async modifyQuery(dbQuery) {
        dbQuery.where("vip", 1);
        return dbQuery;
      }
    }),
    /must mutate the provided query builder/
  );
});

test("createCrudRepositoryFromResource list hooks keep visibility and canonical list controls", async () => {
  const createRepository = createCrudRepositoryFromResource(createResourceFixture());
  const { knex, calls } = createListKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony"
    }
  ]);
  const repository = createRepository(knex);

  await repository.list({
    cursor: 2,
    limit: 5
  }, {
    visibilityContext: {
      visibility: "workspace",
      scopeOwnerId: "workspace-1"
    }
  }, {
    modifyQuery(dbQuery) {
      dbQuery.orderBy("first_name", "desc").limit(99);
      return dbQuery;
    }
  });

  assert.ok(calls.some((call) => call[0] === "where" && call[1] === "contact_id" && call[2] === ">" && call[3] === 2));
  assert.ok(calls.some((call) => call[0] === "where" && call[1] === "workspace_id" && call[2] === "workspace-1"));
  assert.ok(calls.some((call) => call[0] === "clearOrder"));
  assert.ok(calls.some((call) => call[0] === "clear" && call[1] === "limit"));
  assert.ok(calls.some((call) => call[0] === "orderBy" && call[1] === "contact_id" && call[2] === "asc"));
  assert.ok(calls.some((call) => call[0] === "limit" && call[1] === 6));
});

test("createCrudRepositoryFromResource findById hooks keep visibility and id predicates", async () => {
  const createRepository = createCrudRepositoryFromResource(createResourceFixture());
  const { knex, calls } = createListKnexDouble([
    {
      contact_id: 7,
      first_name: "Tony"
    }
  ]);
  const repository = createRepository(knex);

  await repository.findById(7, {
    visibilityContext: {
      visibility: "workspace",
      scopeOwnerId: "workspace-1"
    }
  }, {
    modifyQuery(dbQuery) {
      dbQuery.where("contact_id", 999);
      return dbQuery;
    }
  });

  assert.ok(calls.some((call) => call[0] === "where" && call[1] === "contact_id" && call[2] === 999));
  assert.ok(calls.some((call) => call[0] === "where" && call[1] === "workspace_id" && call[2] === "workspace-1"));
  assert.ok(calls.some((call) => call[0] === "where" && call[1]?.contact_id === 7));
});

test("createCrudRepositoryFromResource findById hooks share state between query and transformReturnedRecord", async () => {
  const createRepository = createCrudRepositoryFromResource(createResourceFixture());
  const { knex } = createListKnexDouble([
    {
      contact_id: 7,
      first_name: "Tony"
    }
  ]);
  const repository = createRepository(knex);

  const record = await repository.findById(7, {}, {
    modifyQuery(_dbQuery, context = {}) {
      context.state.recordTag = "from-state";
    },
    afterQuery(records = [], context = {}) {
      if (records.length > 0) {
        context.state.afterQuerySeen = true;
      }
    },
    transformReturnedRecord(resultRecord = {}, context = {}) {
      return {
        ...resultRecord,
        recordTag: context.state.recordTag,
        afterQuerySeen: context.state.afterQuerySeen || false
      };
    }
  });

  assert.equal(record.recordTag, "from-state");
  assert.equal(record.afterQuerySeen, true);
});

test("createCrudRepositoryFromResource listByIds hooks support afterQuery/transformReturnedRecord/finalizeOutput", async () => {
  const createRepository = createCrudRepositoryFromResource(createResourceFixture());
  const { knex } = createListKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony"
    },
    {
      contact_id: 4,
      first_name: "Sam"
    }
  ]);
  const repository = createRepository(knex);

  const items = await repository.listByIds([3, 4], {}, {
    afterQuery(records = [], context = {}) {
      const namesById = {};
      for (const record of records) {
        namesById[record.id] = record.firstName.toUpperCase();
      }
      context.state.namesById = namesById;
    },
    transformReturnedRecord(record = {}, context = {}) {
      return {
        ...record,
        nameTag: context.state.namesById?.[record.id] || null
      };
    },
    finalizeOutput(records = []) {
      return [...records].reverse();
    }
  });

  assert.deepEqual(items.map((item) => item.id), [4, 3]);
  assert.deepEqual(items.map((item) => item.nameTag), ["SAM", "TONY"]);
});

test("createCrudRepositoryFromResource create hooks keep write-key filtering and ownership stamping", async () => {
  const createRepository = createCrudRepositoryFromResource(createWritableHookResourceFixture());
  const { knex, state } = createListKnexDouble([
    {
      contact_id: 11,
      first_name: "Tony",
      created_at: "2026-01-01 00:00:00",
      updated_at: "2026-01-01 00:00:00"
    }
  ], {
    insertResult: [11]
  });
  const repository = createRepository(knex);

  await repository.create({
    firstName: "Tony"
  }, {
    visibilityContext: {
      visibility: "workspace",
      scopeOwnerId: "workspace-1"
    }
  }, {
    modifyPayload(payload = {}) {
      return {
        ...payload,
        unexpectedField: "blocked",
        workspaceId: "blocked"
      };
    },
    modifyQuery(_dbQuery, context = {}) {
      if (context.payload && typeof context.payload === "object") {
        context.payload.unexpectedFieldFromQuery = "blocked";
      }
    }
  });

  assert.equal(state.insertPayloads.length, 1);
  assert.deepEqual(state.insertPayloads[0].first_name, "Tony");
  assert.equal(Object.hasOwn(state.insertPayloads[0], "unexpectedField"), false);
  assert.equal(Object.hasOwn(state.insertPayloads[0], "unexpectedFieldFromQuery"), false);
  assert.equal(Object.hasOwn(state.insertPayloads[0], "workspaceId"), false);
  assert.equal(state.insertPayloads[0].workspace_id, "workspace-1");
  assert.ok(state.insertPayloads[0].created_at);
  assert.ok(state.insertPayloads[0].updated_at);
});

test("createCrudRepositoryFromResource create hooks support finalizeInsertPayload after write-key filtering", async () => {
  const createRepository = createCrudRepositoryFromResource(createWritableHookResourceFixture());
  const { knex, state } = createListKnexDouble([
    {
      contact_id: 11,
      first_name: "Tony",
      created_at: "2026-01-01 00:00:00",
      updated_at: "2026-01-01 00:00:00"
    }
  ], {
    insertResult: [11]
  });
  const repository = createRepository(knex);

  await repository.create({
    firstName: "Tony",
    hiddenOwnerId: 44
  }, {}, {
    finalizeInsertPayload(insertPayload = {}, context = {}) {
      return {
        ...insertPayload,
        hidden_owner_id: context.payload?.hiddenOwnerId ?? null
      };
    }
  });

  assert.equal(state.insertPayloads.length, 1);
  assert.equal(state.insertPayloads[0].first_name, "Tony");
  assert.equal(state.insertPayloads[0].hidden_owner_id, 44);
});

test("createCrudRepositoryFromResource create hooks reject read-phase hook keys", async () => {
  const createRepository = createCrudRepositoryFromResource(createWritableHookResourceFixture());
  const { knex } = createListKnexDouble([
    {
      contact_id: 11,
      first_name: "Tony",
      created_at: "2026-01-01 00:00:00",
      updated_at: "2026-01-01 00:00:00"
    }
  ], {
    insertResult: [11]
  });
  const repository = createRepository(knex);

  await assert.rejects(
    () => repository.create({
      firstName: "Tony"
    }, {}, {
      transformReturnedRecord(record = {}) {
        return record;
      }
    }),
    /does not support hooks\./
  );
});

test("createCrudRepositoryFromResource create hooks support afterWrite and canonical findById output pipeline", async () => {
  const createRepository = createCrudRepositoryFromResource(createWritableHookResourceFixture());
  const { knex } = createListKnexDouble([
    {
      contact_id: 11,
      first_name: "Tony",
      created_at: "2026-01-01 00:00:00",
      updated_at: "2026-01-01 00:00:00"
    }
  ], {
    insertResult: [11]
  });
  const repository = createRepository(knex);
  const afterWriteCalls = [];

  const record = await repository.create({
    firstName: "Tony"
  }, {}, {
    modifyPayload(payload = {}, context = {}) {
      context.state.createdName = payload.firstName;
      return payload;
    },
    afterWrite(meta = {}, context = {}) {
      afterWriteCalls.push({
        operation: meta.operation,
        createdName: context.state.createdName,
        recordId: meta.recordId
      });
    }
  });

  assert.equal(record.firstName, "Tony");
  assert.equal(Object.hasOwn(record, "createdName"), false);
  assert.equal(afterWriteCalls.length, 1);
  assert.equal(afterWriteCalls[0].operation, "create");
  assert.equal(afterWriteCalls[0].createdName, "Tony");
  assert.equal(afterWriteCalls[0].recordId, 11);
});

test("createCrudRepositoryFromResource update hooks keep write-key filtering and by-id visibility constraints", async () => {
  const createRepository = createCrudRepositoryFromResource(createWritableHookResourceFixture());
  const { knex, calls, state } = createListKnexDouble([
    {
      contact_id: 11,
      first_name: "Tony",
      created_at: "2026-01-01 00:00:00",
      updated_at: "2026-01-01 00:00:00"
    }
  ]);
  const repository = createRepository(knex);

  await repository.updateById(11, {
    firstName: "Tony"
  }, {
    visibilityContext: {
      visibility: "workspace",
      scopeOwnerId: "workspace-1"
    }
  }, {
    modifyPatch(patch = {}) {
      return {
        ...patch,
        unexpectedField: "blocked"
      };
    },
    modifyQuery(dbQuery, context = {}) {
      if (context.patch && typeof context.patch === "object") {
        context.patch.unexpectedFieldFromQuery = "blocked";
      }
      dbQuery.where("vip", 1);
      return dbQuery;
    }
  });

  assert.equal(state.updatePayloads.length, 1);
  assert.deepEqual(state.updatePayloads[0].first_name, "Tony");
  assert.equal(Object.hasOwn(state.updatePayloads[0], "unexpectedField"), false);
  assert.equal(Object.hasOwn(state.updatePayloads[0], "unexpectedFieldFromQuery"), false);
  assert.ok(state.updatePayloads[0].updated_at);
  assert.ok(calls.some((call) => call[0] === "where" && call[1] === "vip" && call[2] === 1));
  assert.ok(calls.some((call) => call[0] === "where" && call[1] === "workspace_id" && call[2] === "workspace-1"));
  assert.ok(calls.some((call) => call[0] === "where" && call[1]?.contact_id === 11));
});

test("createCrudRepositoryFromResource update hooks reject read-phase hook keys", async () => {
  const createRepository = createCrudRepositoryFromResource(createWritableHookResourceFixture());
  const { knex } = createListKnexDouble([
    {
      contact_id: 11,
      first_name: "Tony",
      created_at: "2026-01-01 00:00:00",
      updated_at: "2026-01-01 00:00:00"
    }
  ]);
  const repository = createRepository(knex);

  await assert.rejects(
    () => repository.updateById(11, {
      firstName: "Tony"
    }, {}, {
      transformReturnedRecord(record = {}) {
        return record;
      }
    }),
    /does not support hooks\./
  );
});

test("createCrudRepositoryFromResource update hooks support afterWrite and canonical findById output pipeline", async () => {
  const createRepository = createCrudRepositoryFromResource(createWritableHookResourceFixture());
  const { knex } = createListKnexDouble([
    {
      contact_id: 11,
      first_name: "Tony",
      created_at: "2026-01-01 00:00:00",
      updated_at: "2026-01-01 00:00:00"
    }
  ]);
  const repository = createRepository(knex);
  const afterWriteCalls = [];

  const record = await repository.updateById(11, {
    firstName: "Tony"
  }, {}, {
    modifyPatch(patch = {}, context = {}) {
      context.state.patchKeys = Object.keys(patch);
      return patch;
    },
    afterWrite(meta = {}, context = {}) {
      afterWriteCalls.push({
        operation: meta.operation,
        patchKeys: context.state.patchKeys || [],
        recordId: meta.recordId
      });
    }
  });

  assert.equal(record.firstName, "Tony");
  assert.equal(Object.hasOwn(record, "patchKeys"), false);
  assert.equal(afterWriteCalls.length, 1);
  assert.equal(afterWriteCalls[0].operation, "update");
  assert.deepEqual(afterWriteCalls[0].patchKeys, ["firstName"]);
  assert.equal(afterWriteCalls[0].recordId, 11);
});

test("createCrudRepositoryFromResource delete hooks run through callOptions.trx client", async () => {
  const createRepository = createCrudRepositoryFromResource(createResourceFixture());
  const baseKnex = createListKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony"
    }
  ]);
  const trxKnex = createListKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony"
    }
  ]);
  const repository = createRepository(baseKnex.knex);

  await repository.deleteById(3, {
    trx: trxKnex.knex,
    visibilityContext: {
      visibility: "workspace",
      scopeOwnerId: "workspace-1"
    }
  }, {
    modifyQuery(dbQuery) {
      dbQuery.where("vip", 1);
      return dbQuery;
    }
  });

  assert.equal(baseKnex.calls.some((call) => call[0] === "table"), false);
  assert.ok(trxKnex.calls.some((call) => call[0] === "table" && call[1] === "contacts_table"));
  assert.ok(trxKnex.calls.some((call) => call[0] === "where" && call[1] === "vip" && call[2] === 1));
  assert.ok(trxKnex.calls.some((call) => call[0] === "delete"));
});

test("createCrudRepositoryFromResource delete hooks support afterWrite", async () => {
  const createRepository = createCrudRepositoryFromResource(createResourceFixture());
  const { knex } = createListKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony"
    }
  ]);
  const repository = createRepository(knex);
  const afterWriteCalls = [];

  const result = await repository.deleteById(3, {}, {
    afterWrite(meta = {}, context = {}) {
      context.state.deletedId = meta?.output?.id || null;
      afterWriteCalls.push({
        operation: meta.operation,
        deletedId: context.state.deletedId
      });
    }
  });

  assert.equal(result.deleted, true);
  assert.equal(afterWriteCalls.length, 1);
  assert.equal(afterWriteCalls[0].operation, "delete");
  assert.equal(afterWriteCalls[0].deletedId, 3);
});

test("createCrudRepositoryFromResource delete hooks support finalizeOutput for record and null flows", async () => {
  const createRepository = createCrudRepositoryFromResource(createResourceFixture());
  const presentKnex = createListKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony"
    }
  ]);
  const missingKnex = createListKnexDouble([]);
  const presentRepository = createRepository(presentKnex.knex);
  const missingRepository = createRepository(missingKnex.knex);

  const deletedOutput = await presentRepository.deleteById(3, {}, {
    finalizeOutput(output) {
      return output
        ? { ...output, status: "deleted" }
        : output;
    }
  });

  const missingOutput = await missingRepository.deleteById(3, {}, {
    finalizeOutput(output) {
      return output === null ? { deleted: false } : output;
    }
  });

  assert.equal(deletedOutput.status, "deleted");
  assert.deepEqual(missingOutput, { deleted: false });
});
