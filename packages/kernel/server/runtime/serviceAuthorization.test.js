import assert from "node:assert/strict";
import test from "node:test";
import { requireAuth, createAuthorizedService, getServicePermissions } from "./serviceAuthorization.js";

test("requireAuth allows public mode without actor", () => {
  assert.doesNotThrow(() =>
    requireAuth(
      {
        context: {}
      },
      {
        require: "none"
      }
    )
  );
});

test("requireAuth accepts actor context", () => {
  const actor = requireAuth({
    context: {
      actor: {
        id: 7
      }
    }
  });

  assert.equal(actor.id, 7);
});

test("requireAuth throws when actor is missing", () => {
  assert.throws(
    () => requireAuth({ context: {} }),
    (error) => error?.statusCode === 401 && error?.code === "AUTHENTICATION_REQUIRED"
  );
});

test("requireAuth enforces all permissions", () => {
  assert.throws(
    () =>
      requireAuth(
        {
          context: {
            actor: { id: 1 },
            permissions: ["workspace.settings.view"]
          }
        },
        {
          require: "all",
          permissions: ["workspace.settings.update"]
        }
      ),
    (error) => error?.statusCode === 403 && error?.code === "PERMISSION_DENIED"
  );
});

test("requireAuth allows wildcard permission for any mode", () => {
  assert.doesNotThrow(() =>
    requireAuth(
      {
        context: {
          actor: { id: 1 },
          permissions: ["*"]
        }
      },
      {
        require: "any",
        permissions: ["workspace.settings.view", "workspace.settings.update"]
      }
    )
  );
});

test("createAuthorizedService enforces declared permissions and exposes metadata", async () => {
  const service = createAuthorizedService(
    {
      async list(_query = {}, options = {}) {
        return options.context.actor.id;
      },
      async view(_id, options = {}) {
        return options.context.actor.id;
      },
      async publicPing() {
        return "ok";
      }
    },
    {
      list: { require: "all", permissions: ["records.view"] },
      view: { require: "any", permissions: ["records.view", "records.manage"] },
      publicPing: { require: "none" }
    }
  );

  assert.throws(
    () =>
      service.list(
        {},
        {
          context: {
            actor: { id: 1 },
            permissions: []
          }
        }
      ),
    (error) => error?.statusCode === 403
  );

  const listResult = await service.list(
    {},
    {
      context: {
        actor: { id: 1 },
        permissions: ["records.view"]
      }
    }
  );
  assert.equal(listResult, 1);

  const pingResult = await service.publicPing();
  assert.equal(pingResult, "ok");

  const permissions = getServicePermissions(service);
  assert.equal(permissions.list.require, "all");
  assert.deepEqual(permissions.view.permissions, ["records.view", "records.manage"]);
  assert.equal(permissions.publicPing.require, "none");
});

test("createAuthorizedService rejects missing and unknown permission keys", () => {
  assert.throws(
    () =>
      createAuthorizedService(
        {
          async list() {}
        },
        {}
      ),
    /servicePermissions\.list/
  );

  assert.throws(
    () =>
      createAuthorizedService(
        {
          async list() {}
        },
        {
          list: { require: "none" },
          create: { require: "none" }
        }
      ),
    /unknown servicePermissions key/
  );
});
