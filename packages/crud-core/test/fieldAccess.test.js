import test from "node:test";
import assert from "node:assert/strict";
import { createFieldAccessForRoleMatrix } from "../src/server/fieldAccess.js";

test("createFieldAccessForRoleMatrix resolves role and action policies", () => {
  const fieldAccess = createFieldAccessForRoleMatrix({
    default: {
      readable: {
        list: ["id", "name"],
        "*": ["id"]
      },
      writable: {
        create: ["name"],
        update: ["name"]
      }
    },
    admin: {
      readable: "*",
      writable: "*"
    },
    writeMode: "strip"
  });

  assert.equal(fieldAccess.writeMode, "strip");
  assert.deepEqual(
    fieldAccess.readable({
      action: "list",
      context: { auth: { role: "user" } }
    }),
    ["id", "name"]
  );
  assert.deepEqual(
    fieldAccess.readable({
      action: "view",
      context: { auth: { role: "user" } }
    }),
    ["id"]
  );
  assert.equal(
    fieldAccess.writable({
      action: "update",
      context: { auth: { role: "admin" } }
    }),
    "*"
  );
});

test("createFieldAccessForRoleMatrix supports function policies and default role fallback", () => {
  const fieldAccess = createFieldAccessForRoleMatrix({
    default: {
      readable: ({ action }) => (action === "list" ? ["id"] : ["id", "name"]),
      writable: {
        "*": ["name"]
      }
    }
  });

  assert.deepEqual(
    fieldAccess.readable({
      action: "list",
      context: { auth: { role: "unknown" } }
    }),
    ["id"]
  );
  assert.deepEqual(
    fieldAccess.readable({
      action: "view",
      context: { auth: { role: "unknown" } }
    }),
    ["id", "name"]
  );
  assert.deepEqual(
    fieldAccess.writable({
      action: "update",
      context: { auth: { role: "unknown" } }
    }),
    ["name"]
  );
});

test("createFieldAccessForRoleMatrix validates writeMode", () => {
  assert.throws(
    () => createFieldAccessForRoleMatrix({ writeMode: "invalid-mode" }),
    /fieldAccess\.writeMode must be "throw" or "strip"/
  );
});
