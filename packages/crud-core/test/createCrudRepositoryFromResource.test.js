import test from "node:test";
import assert from "node:assert/strict";
import { createCrudRepositoryFromResource } from "../src/server/createCrudRepositoryFromResource.js";

function createListKnexDouble(rows = []) {
  const calls = [];
  let firstMode = false;
  const whereGroup = {
    where(...args) {
      calls.push(["where", ...args]);
      return whereGroup;
    },
    orWhere(...args) {
      calls.push(["orWhere", ...args]);
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
    orderBy(...args) {
      calls.push(["orderBy", ...args]);
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
    then(resolve, reject) {
      const payload = firstMode ? rows[0] || null : rows;
      return Promise.resolve(payload).then(resolve, reject);
    }
  };

  const knex = (tableName) => {
    calls.push(["table", tableName]);
    return query;
  };

  return {
    knex,
    calls
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
