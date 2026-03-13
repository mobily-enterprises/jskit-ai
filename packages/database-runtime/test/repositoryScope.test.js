import assert from "node:assert/strict";
import test from "node:test";
import { createRepositoryScope } from "../src/shared/repositoryScope.js";

function createQueryBuilder(calls) {
  return {
    where(...args) {
      calls.push(["where", ...args]);
      return this;
    },
    whereRaw(sql) {
      calls.push(["whereRaw", sql]);
      return this;
    }
  };
}

function createKnexStub() {
  const calls = [];

  function knex(tableName) {
    calls.push(["table", tableName]);
    return createQueryBuilder(calls);
  }

  return { knex, calls };
}

test("createRepositoryScope builds explicit scoped query helpers", () => {
  const { knex, calls } = createKnexStub();
  const scope = createRepositoryScope(knex, "contacts");

  scope.scoped({
    visibilityContext: {
      visibility: "workspace",
      workspaceOwnerId: 12
    }
  });

  assert.deepEqual(calls, [["table", "contacts"], ["where", "workspace_owner_id", 12]]);
});

test("createRepositoryScope supports scopedById with custom id column", () => {
  const { knex, calls } = createKnexStub();
  const scope = createRepositoryScope(knex, "contacts", {
    idColumn: "contact_id"
  });

  scope.scopedById(33, {
    visibilityContext: {
      visibility: "user",
      userOwnerId: 7
    }
  });

  assert.deepEqual(calls, [["table", "contacts"], ["where", "user_owner_id", 7], ["where", "contact_id", 33]]);
});

test("createRepositoryScope exposes applyToQuery and owner stamping", () => {
  const { knex, calls } = createKnexStub();
  const scope = createRepositoryScope(knex, "contacts");
  const queryBuilder = createQueryBuilder(calls);

  scope.applyToQuery(queryBuilder, {
    visibilityContext: {
      visibility: "workspace_user",
      workspaceOwnerId: 4,
      userOwnerId: 9
    }
  });

  assert.deepEqual(calls, [["where", "workspace_owner_id", 4], ["where", "user_owner_id", 9]]);

  assert.deepEqual(
    scope.withOwners(
      {
        name: "Ada"
      },
      {
        visibilityContext: {
          visibility: "workspace_user",
          workspaceOwnerId: 4,
          userOwnerId: 9
        }
      }
    ),
    {
      name: "Ada",
      workspace_owner_id: 4,
      user_owner_id: 9
    }
  );

  assert.equal(scope.clientOf(), knex);
  assert.equal(typeof scope.table, "function");
});

test("createRepositoryScope validates required inputs", () => {
  const { knex } = createKnexStub();

  assert.throws(() => createRepositoryScope(null, "contacts"), /requires knex/);
  assert.throws(() => createRepositoryScope(knex, ""), /requires tableName/);
});
