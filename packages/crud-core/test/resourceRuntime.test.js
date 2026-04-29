import test from "node:test";
import assert from "node:assert/strict";
import { createSchema } from "json-rest-schema";
import { RECORD_ID_PATTERN } from "@jskit-ai/kernel/shared/validators";
import { createCrudResourceRuntime } from "../src/server/resourceRuntime/index.js";

const recordIdSchema = Object.freeze({
  type: "string",
  pattern: RECORD_ID_PATTERN
});

const nullableRecordIdSchema = Object.freeze({
  anyOf: [
    recordIdSchema,
    { type: "null" }
  ]
});

function createKnexDouble(
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
      forUpdate() {
        calls.push(["forUpdate"]);
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

  const knex = Object.assign((tableName) => {
    calls.push(["table", tableName]);
    return createQueryBuilder();
  }, {
    async transaction(work) {
      return work({ trxId: "trx-1" });
    }
  });

  return {
    knex,
    calls,
    state
  };
}

function createResourceFixture() {
  return {
    namespace: "contacts",
    tableName: "contacts_table",
    idColumn: "contact_id",
    operations: {
      view: {
        output: {
          schema: {
            type: "object",
            properties: {
              id: {
                ...recordIdSchema,
                actualField: "contact_id"
              },
              firstName: { type: "string" }
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
}

function createLookupResourceFixture() {
  return {
    namespace: "contacts",
    tableName: "contacts_table",
    idColumn: "contact_id",
    operations: {
      view: {
        output: {
          schema: {
            type: "object",
            properties: {
              id: {
                ...recordIdSchema,
                actualField: "contact_id"
              },
              firstName: { type: "string" },
              primaryVetId: {
                ...recordIdSchema,
                actualField: "primary_vet_id",
                relation: {
                  kind: "lookup",
                  namespace: "vets",
                  valueKey: "id"
                }
              },
              secondaryVetId: {
                ...nullableRecordIdSchema,
                actualField: "secondary_vet_id",
                relation: {
                  kind: "lookup",
                  namespace: "vets",
                  valueKey: "id"
                }
              },
              lookups: {
                type: "object"
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
}

function createLeafLookupResourceFixture() {
  return {
    namespace: "users",
    tableName: "users_table",
    idColumn: "user_id",
    operations: {
      view: {
        output: {
          schema: {
            type: "object",
            properties: {
              id: {
                ...recordIdSchema,
                actualField: "user_id"
              },
              name: {
                type: "string",
                actualField: "display_name"
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
      }
    }
  };
}

function createNormalizedWriteResourceFixture() {
  return {
    namespace: "contacts",
    tableName: "contacts_table",
    idColumn: "contact_id",
    operations: {
      view: {
        output: {
          schema: {
            type: "object",
            properties: {
              id: {
                ...recordIdSchema,
                actualField: "contact_id"
              },
              firstName: {
                type: "string",
                actualField: "first_name"
              },
              lastSeenAt: {
                actualField: "last_seen_at",
                anyOf: [
                  { type: "string" },
                  { type: "null" }
                ]
              }
            }
          }
        }
      },
      create: {
        body: {
          schema: createSchema({
            firstName: {
              type: "string",
              required: true,
              minLength: 1,
              actualField: "first_name"
            }
          }),
          mode: "create"
        }
      },
      patch: {
        body: {
          schema: createSchema({
            firstName: {
              type: "string",
              required: false,
              minLength: 1,
              actualField: "first_name"
            },
            lastSeenAt: {
              type: "string",
              required: false,
              actualField: "last_seen_at"
            }
          }),
          mode: "patch"
        }
      }
    }
  };
}

function createVirtualProjectionResourceFixture() {
  return {
    namespace: "receivals",
    tableName: "receivals_table",
    idColumn: "receival_id",
    operations: {
      view: {
        output: {
          schema: {
            type: "object",
            properties: {
              id: {
                ...recordIdSchema,
                actualField: "receival_id"
              },
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
}

test("createCrudResourceRuntime requires table metadata from resource", () => {
  const { knex } = createKnexDouble();
  assert.throws(
    () =>
      createCrudResourceRuntime({
        operations: {
          view: {
            output: {
              schema: {
                type: "object",
                properties: {
                  id: recordIdSchema
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
          }
        }
      }, knex),
    /requires resource\.tableName or resource\.namespace/
  );
});

test("createCrudResourceRuntime binds methods directly and exposes withTransaction", async () => {
  const { knex } = createKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony"
    }
  ]);
  const repository = createCrudResourceRuntime(createResourceFixture(), knex);

  assert.equal(typeof repository.list, "function");
  assert.equal(typeof repository.findById, "function");
  assert.equal(typeof repository.listByIds, "function");
  assert.equal(typeof repository.listByForeignIds, "function");
  assert.equal(typeof repository.create, "function");
  assert.equal(typeof repository.updateById, "function");
  assert.equal(typeof repository.deleteById, "function");
  assert.equal(typeof repository.withTransaction, "function");

  const transactionResult = await repository.withTransaction(async (trx) => ({ id: trx.trxId }));
  assert.deepEqual(transactionResult, { id: "trx-1" });
});

test("list uses resource table and id defaults", async () => {
  const { knex, calls } = createKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony"
    }
  ]);
  const repository = createCrudResourceRuntime(createResourceFixture(), knex);

  const result = await repository.list({
    cursor: "2",
    q: "to"
  });

  assert.deepEqual(result, {
    items: [
      {
        id: "3",
        firstName: "Tony"
      }
    ],
    nextCursor: null
  });
  assert.equal(calls[0][1], "contacts_table");
  assert.ok(calls.some((call) => call[0] === "where" && call[1] === "contact_id" && call[2] === ">" && call[3] === "2"));
});

test("list respects bound list config", async () => {
  const { knex, calls } = createKnexDouble([
    { contact_id: 3, first_name: "Tony" },
    { contact_id: 4, first_name: "Tom" },
    { contact_id: 5, first_name: "Toby" }
  ]);
  const repository = createCrudResourceRuntime(createResourceFixture(), knex, {
    list: {
      defaultLimit: 1,
      maxLimit: 2,
      searchColumns: ["first_name"]
    }
  });

  await repository.list({
    q: "to",
    limit: 99
  });

  assert.ok(calls.some((call) => call[0] === "where" && call[1] === "first_name" && call[2] === "like" && call[3] === "%to%"));
  assert.ok(calls.some((call) => call[0] === "limit" && call[1] === 3));
});

test("list supports configured virtual projections", async () => {
  const { knex, calls } = createKnexDouble([
    {
      receival_id: 3,
      first_name: "Tony",
      remaining_batch_weight: 12
    }
  ]);
  const repository = createCrudResourceRuntime(createVirtualProjectionResourceFixture(), knex, {
    virtualFields: {
      remainingBatchWeight: {
        applyProjection(dbQuery) {
          dbQuery.select("remaining_batch_weight");
        }
      }
    }
  });

  const result = await repository.list();
  assert.equal(result.items[0].remainingBatchWeight, 12);
  assert.ok(calls.some((call) => call[0] === "select" && call.includes("remaining_batch_weight")));
});

test("list hydrates lookups from callOptions.include", async () => {
  const { knex } = createKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony",
      primary_vet_id: 10,
      secondary_vet_id: 12
    }
  ]);

  const lookupCalls = [];
  const repository = createCrudResourceRuntime(createLookupResourceFixture(), knex, {
    resolveLookup() {
      return {
        async listByIds(ids = [], options = {}) {
          lookupCalls.push({
            ids,
            options
          });
          return [
            { id: "10", name: "Vet A" },
            { id: "12", name: "Vet B" }
          ];
        }
      };
    }
  });

  const result = await repository.list({}, {
    include: "*"
  });

  assert.equal(lookupCalls.length, 1);
  assert.deepEqual(lookupCalls[0].ids, ["10", "12"]);
  assert.equal(lookupCalls[0].options.include, "*");
  assert.deepEqual(result.items[0].lookups, {
    primaryVetId: { id: "10", name: "Vet A" },
    secondaryVetId: { id: "12", name: "Vet B" }
  });
});

test("list forwards nested include paths to child lookup repositories", async () => {
  const { knex } = createKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony",
      primary_vet_id: 10,
      secondary_vet_id: 12
    }
  ]);

  const lookupCalls = [];
  const repository = createCrudResourceRuntime(createLookupResourceFixture(), knex, {
    resolveLookup() {
      return {
        async listByIds(ids = [], options = {}) {
          lookupCalls.push({
            ids,
            options
          });
          return [{ id: "10", name: "Vet A" }, { id: "12", name: "Vet B" }];
        }
      };
    }
  });

  await repository.list({}, {
    include: "primaryVetId.vetTypeId"
  });

  assert.equal(lookupCalls.length, 1);
  assert.equal(lookupCalls[0].options.include, "vetTypeId");
});

test("list wildcard hydration does not fail when child lookup resources declare no nested lookups", async () => {
  const { knex } = createKnexDouble([
    {
      contact_id: 3,
      first_name: "Tony",
      primary_vet_id: 10,
      secondary_vet_id: 12
    }
  ]);
  const { knex: childKnex } = createKnexDouble([
    {
      user_id: 10,
      display_name: "Vet A"
    },
    {
      user_id: 12,
      display_name: "Vet B"
    }
  ]);

  const childRepository = createCrudResourceRuntime(createLeafLookupResourceFixture(), childKnex, {
    context: "users repository"
  });
  const repository = createCrudResourceRuntime(createLookupResourceFixture(), knex, {
    resolveLookup() {
      return {
        async listByIds(ids = [], options = {}) {
          return childRepository.listByIds(ids, options);
        }
      };
    }
  });

  const result = await repository.list({}, {
    include: "*"
  });

  assert.deepEqual(result.items[0].lookups, {
    primaryVetId: { id: "10", name: "Vet A" },
    secondaryVetId: { id: "12", name: "Vet B" }
  });
});

test("operations.read.applyQuery and operations.list.applyQuery run before canonical filters", async () => {
  const { knex, calls } = createKnexDouble([
    {
      contact_id: 7,
      first_name: "Tony"
    }
  ]);
  const repository = createCrudResourceRuntime(createResourceFixture(), knex, {
    operations: {
      read: {
        applyQuery(dbQuery) {
          dbQuery.whereNull("deleted_at");
          return dbQuery;
        }
      },
      list: {
        applyQuery(dbQuery, { query = {} } = {}) {
          if (query.onlyVip === true) {
            dbQuery.where("vip", 1);
          }
          return dbQuery;
        }
      }
    }
  });

  await repository.list({
    onlyVip: true
  }, {
    visibilityContext: {
      visibility: "workspace",
      scopeOwnerId: "workspace-1"
    }
  });

  assert.ok(calls.some((call) => call[0] === "whereNull" && call[1] === "deleted_at"));
  assert.ok(calls.some((call) => call[0] === "where" && call[1] === "vip" && call[2] === 1));
  assert.ok(calls.some((call) => call[0] === "where" && call[1] === "workspace_id" && call[2] === "workspace-1"));
});

test("findById supports forUpdate via callOptions", async () => {
  const { knex, calls } = createKnexDouble([
    {
      contact_id: 7,
      first_name: "Tony"
    }
  ]);
  const repository = createCrudResourceRuntime(createResourceFixture(), knex);

  await repository.findById("7", {
    trx: knex,
    forUpdate: true
  });

  assert.ok(calls.some((call) => call[0] === "forUpdate"));
});

test("listByIds supports alternate valueKey and listByForeignIds delegates to it", async () => {
  const resource = {
    ...createResourceFixture(),
    operations: {
      ...createResourceFixture().operations,
      view: {
        output: {
          schema: {
            type: "object",
            properties: {
              id: recordIdSchema,
              foreignId: {
                ...recordIdSchema,
                actualField: "foreign_id"
              },
              firstName: { type: "string" }
            }
          }
        }
      }
      }
  };
  const { knex, calls } = createKnexDouble([
    {
      contact_id: 7,
      foreign_id: 12,
      first_name: "Tony"
    }
  ]);
  const repository = createCrudResourceRuntime(resource, knex);

  const direct = await repository.listByIds(["12"], {
    valueKey: "foreignId"
  });
  const delegated = await repository.listByForeignIds(["12"], "foreignId");

  assert.equal(direct.length, 1);
  assert.equal(delegated.length, 1);
  assert.ok(calls.some((call) => call[0] === "whereIn" && call[1] === "foreign_id"));
});

test("create uses operations.create.prepareInsertPayload before insert", async () => {
  const { knex, state } = createKnexDouble([
    {
      contact_id: 11,
      first_name: "Tony",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z"
    }
  ], {
    insertResult: [11]
  });
  const resource = {
    namespace: "contacts",
    tableName: "contacts_table",
    idColumn: "contact_id",
    operations: {
      view: {
        output: {
          schema: {
            type: "object",
            properties: {
              id: {
                ...recordIdSchema,
                actualField: "contact_id"
              },
              firstName: { type: "string" },
              createdAt: {
                type: "string",
                actualField: "created_at"
              },
              updatedAt: {
                type: "string",
                actualField: "updated_at"
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
  const repository = createCrudResourceRuntime(resource, knex, {
    operations: {
      create: {
        prepareInsertPayload(insertPayload = {}, context = {}) {
          return {
            ...insertPayload,
            first_name: context.payload.firstName.toUpperCase()
          };
        }
      }
    }
  });

  await repository.create({
    firstName: "Tony"
  });

  assert.equal(state.insertPayloads[0].first_name, "TONY");
});

test("create normalizes resource body payloads before insert", async () => {
  const rows = [
    {
      contact_id: 11,
      first_name: "Tony"
    }
  ];
  const { knex, state } = createKnexDouble(rows, {
    insertResult: [11]
  });
  const repository = createCrudResourceRuntime(createNormalizedWriteResourceFixture(), knex);

  await repository.create({
    firstName: "  Tony  "
  });

  assert.equal(state.insertPayloads[0].first_name, "Tony");
});

test("update and delete keep canonical by-id behavior", async () => {
  const rows = [
    {
      contact_id: 11,
      first_name: "Tony"
    }
  ];
  const { knex, state } = createKnexDouble(rows, {
    insertResult: [11]
  });
  const repository = createCrudResourceRuntime(createResourceFixture(), knex);

  const updated = await repository.updateById("11", {
    firstName: "Tom"
  });
  const deleted = await repository.deleteById("11");

  assert.equal(state.updatePayloads.length, 1);
  assert.equal(state.deleteCount, 1);
  assert.equal(updated.id, "11");
  assert.deepEqual(deleted, {
    id: "11",
    deleted: true
  });
});

test("update normalizes resource patch payloads before persistence", async () => {
  const rows = [
    {
      contact_id: 11,
      first_name: "Tony",
      last_seen_at: null
    }
  ];
  const { knex, state } = createKnexDouble(rows, {
    insertResult: [11]
  });
  const repository = createCrudResourceRuntime(createNormalizedWriteResourceFixture(), knex);

  await repository.updateById("11", {
    firstName: " Tom "
  });

  assert.equal(state.updatePayloads[0].first_name, "Tom");
});

test("update maps patch-only resource fields into the DB payload", async () => {
  const rows = [
    {
      contact_id: 11,
      first_name: "Tony",
      last_seen_at: null
    }
  ];
  const { knex, state } = createKnexDouble(rows, {
    insertResult: [11]
  });
  const repository = createCrudResourceRuntime(createNormalizedWriteResourceFixture(), knex);

  await repository.updateById("11", {
    lastSeenAt: " 2026-01-01T00:00:00.000Z "
  });

  assert.equal(state.updatePayloads[0].last_seen_at, "2026-01-01T00:00:00.000Z");
});

test("resourceRuntime maps schema field errors for create and update", async () => {
  const rows = [
    {
      contact_id: 11,
      first_name: "Tony"
    }
  ];
  const { knex } = createKnexDouble(rows, {
    insertResult: [11]
  });
  const repository = createCrudResourceRuntime(createNormalizedWriteResourceFixture(), knex);

  await assert.rejects(
    () => repository.create({ firstName: "   " }),
    (error) => (
      error?.status === 400 &&
      typeof error?.details?.fieldErrors?.firstName === "string"
    )
  );

  await assert.rejects(
    () => repository.updateById("11", { firstName: "   " }),
    (error) => (
      error?.status === 400 &&
      typeof error?.details?.fieldErrors?.firstName === "string"
    )
  );
});
