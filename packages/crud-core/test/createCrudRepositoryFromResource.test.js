import test from "node:test";
import assert from "node:assert/strict";
import { createCrudRepositoryFromResource } from "../src/server/createCrudRepositoryFromResource.js";

function createListKnexDouble(rows = []) {
  const calls = [];
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
    then(resolve, reject) {
      return Promise.resolve(rows).then(resolve, reject);
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
