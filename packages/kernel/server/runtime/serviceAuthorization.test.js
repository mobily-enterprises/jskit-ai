import assert from "node:assert/strict";
import test from "node:test";
import { requireAuth } from "./serviceAuthorization.js";

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

test("requireAuth allows namespace wildcard permissions", () => {
  assert.doesNotThrow(() =>
    requireAuth(
      {
        context: {
          actor: { id: 1 },
          permissions: ["crud_contacts.*"]
        }
      },
      {
        require: "all",
        permissions: ["crud_contacts.update"]
      }
    )
  );
});
