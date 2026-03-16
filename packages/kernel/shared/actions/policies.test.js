import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";

import { ensureActionPermissionAllowed, normalizeActionInput, normalizeActionOutput } from "./policies.js";

test("function schema returns normalized value when ok", async () => {
  const definition = {
    id: "tests.ok",
    version: 1,
    inputValidator: {
      schema: () => ({
        ok: true,
        value: {
          normalized: true
        }
      })
    }
  };

  const result = await normalizeActionInput(definition, { raw: true }, {});
  assert.deepEqual(result, { normalized: true });
});

test("function schema rejects non-validator results", async () => {
  const definition = {
    id: "tests.invalid",
    version: 1,
    inputValidator: {
      schema: () => false
    }
  };

  await assert.rejects(
    () => normalizeActionInput(definition, { raw: true }, {}),
    (error) => {
      assert.equal(error.code, "ACTION_VALIDATION_FAILED");
      assert.match(error.details?.error || "", /Schema validator must return/);
      return true;
    }
  );
});

test("function schema propagates validation errors", async () => {
  const definition = {
    id: "tests.errors",
    version: 2,
    inputValidator: {
      schema: () => ({
        ok: false,
        errors: {
          input: "input is required"
        }
      })
    }
  };

  await assert.rejects(
    () => normalizeActionInput(definition, null, {}),
    (error) => {
      assert.equal(error.code, "ACTION_VALIDATION_FAILED");
      assert.deepEqual(error.details?.fieldErrors, {
        input: "input is required"
      });
      return true;
    }
  );
});

test("raw TypeBox action schemas validate normalized action input", async () => {
  const definition = {
    id: "tests.typebox",
    version: 1,
    inputValidator: {
      schema: Type.Object(
        {
          workspaceSlug: Type.String({ minLength: 1 })
        },
        { additionalProperties: false }
      ),
      normalize(value = {}) {
        return {
          workspaceSlug: String(value.workspaceSlug || "").trim().toLowerCase()
        };
      }
    }
  };

  const result = await normalizeActionInput(definition, { workspaceSlug: "  ACME  " }, {});
  assert.deepEqual(result, { workspaceSlug: "acme" });
});

test("action output normalization runs before output validation", async () => {
  const definition = {
    id: "tests.output",
    version: 1,
    outputValidator: {
      schema: Type.Object(
        {
          ok: Type.Boolean()
        },
        { additionalProperties: false }
      ),
      normalize(payload = {}) {
        return {
          ok: Boolean(payload.ok)
        };
      }
    }
  };

  const result = await normalizeActionOutput(definition, { ok: 1 }, {});
  assert.deepEqual(result, { ok: true });
});

test("action permission denies unauthenticated access when required", () => {
  assert.throws(
    () =>
      ensureActionPermissionAllowed(
        {
          id: "tests.secure",
          permission: {
            require: "authenticated"
          }
        },
        {
          permissions: []
        }
      ),
    (error) => error?.statusCode === 401 && error?.code === "ACTION_AUTHENTICATION_REQUIRED"
  );
});

test("action permission enforces required permissions", () => {
  assert.throws(
    () =>
      ensureActionPermissionAllowed(
        {
          id: "tests.secure.perm",
          permission: {
            require: "all",
            permissions: ["workspace.settings.update"]
          }
        },
        {
          actor: {
            id: 7
          },
          permissions: ["workspace.settings.view"]
        }
      ),
    (error) => error?.statusCode === 403 && error?.code === "ACTION_PERMISSION_DENIED"
  );

  assert.doesNotThrow(() =>
    ensureActionPermissionAllowed(
      {
        id: "tests.secure.perm",
        permission: {
          require: "all",
          permissions: ["workspace.settings.update"]
        }
      },
      {
        actor: {
          id: 7
        },
        permissions: ["workspace.settings.update"]
      }
    )
  );
});
