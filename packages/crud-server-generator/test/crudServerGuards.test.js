import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createTemplateServerFixture } from "../test-support/templateServerFixture.js";
import descriptor from "../package.descriptor.mjs";

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

test("crud generator appends member role grants for generated CRUD permissions", () => {
  assert.deepEqual(
    descriptor.mutations.text,
    [
      {
        op: "append-text",
        file: "config/roles.js",
        position: "bottom",
        skipIfContains: "\"crud.${option:namespace|snake}.list\"",
        value:
          "\nroleCatalog.roles.member.permissions.push(\n  \"crud.${option:namespace|snake}.list\",\n  \"crud.${option:namespace|snake}.view\",\n  \"crud.${option:namespace|snake}.create\",\n  \"crud.${option:namespace|snake}.update\",\n  \"crud.${option:namespace|snake}.delete\"\n);\n",
        reason: "Grant generated CRUD action permissions to the default member role in the app-owned role catalog.",
        category: "crud",
        id: "crud-role-catalog-permissions-${option:namespace|snake}"
      }
    ]
  );
});
