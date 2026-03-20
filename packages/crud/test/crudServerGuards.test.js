import test from "node:test";
import assert from "node:assert/strict";
import { createActions } from "../src/server/actions.js";
import { createActionIds } from "../src/server/actionIds.js";
import { createRepository } from "../src/server/repository.js";
import { registerRoutes } from "../src/server/registerRoutes.js";

test("createActionIds requires explicit actionIdPrefix", () => {
  assert.throws(
    () => createActionIds(""),
    /requires actionIdPrefix/
  );
});

test("createRepository requires explicit tableName", () => {
  const knex = () => {
    throw new Error("not expected");
  };

  assert.throws(
    () => createRepository(knex, {}),
    /requires tableName/
  );
});

test("createActions requires explicit surface", () => {
  assert.throws(
    () =>
      createActions({
        actionIdPrefix: "crud.customers"
      }),
    /requires a non-empty surface/
  );
});

test("registerRoutes requires explicit routeBasePath and actionIds", () => {
  const app = {
    make() {
      return {
        register() {}
      };
    }
  };

  assert.throws(
    () => registerRoutes(app, {}),
    /requires routeBasePath/
  );

  assert.throws(
    () =>
      registerRoutes(app, {
        routeBasePath: "/api/w/:workspaceSlug/workspace/customers",
        actionIds: {
          list: "crud.customers.list"
        }
      }),
    /requires actionIds.view/
  );
});
