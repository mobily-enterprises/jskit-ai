import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createTemplateServerFixture } from "../test-support/templateServerFixture.js";

const fixture = await createTemplateServerFixture();
const { createActions } = await fixture.importServerModule("actions.js");
const { createRepository } = await fixture.importServerModule("repository.js");

after(async () => {
  await fixture.cleanup();
});

test("template createRepository defaults tableName from resource metadata", () => {
  const query = {
    select() {
      return query;
    },
    where() {
      return query;
    },
    orderBy() {
      return query;
    },
    modify(callback) {
      if (typeof callback === "function") {
        callback(query);
      }
      return query;
    },
    limit() {
      return query;
    },
    then(resolve) {
      return Promise.resolve([]).then(resolve);
    }
  };
  const tables = [];
  const knex = (tableName) => {
    tables.push(tableName);
    return query;
  };

  const repository = createRepository(knex, {});
  assert.equal(typeof repository.list, "function");
  return repository.list({}).then(() => {
    assert.equal(tables[0], "customers");
  });
});

test("template createActions requires explicit surface", () => {
  assert.throws(
    () => createActions({}),
    /requires a non-empty surface/
  );
});

test("template createActions requires namespaced CRUD permissions by default", () => {
  const actions = createActions({ surface: "admin" });

  assert.deepEqual(
    actions.map((action) => action.permission),
    [
      { require: "all", permissions: ["crud.customers.list"] },
      { require: "all", permissions: ["crud.customers.view"] },
      { require: "all", permissions: ["crud.customers.create"] },
      { require: "all", permissions: ["crud.customers.update"] },
      { require: "all", permissions: ["crud.customers.delete"] }
    ]
  );
});
