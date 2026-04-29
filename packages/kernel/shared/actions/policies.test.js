import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";

import { ensureActionPermissionAllowed, normalizeActionInput, normalizeActionOutput } from "./policies.js";

function createMockJsonRestSchema() {
  return {
    async create(payload = {}) {
      const name = String(payload?.name || "").trim();
      const errors = {};
      if (!name) {
        errors.name = {
          message: "Name is required."
        };
      }

      return {
        validatedObject: Object.keys(errors).length < 1 ? { name } : {},
        errors
      };
    },
    async replace(payload = {}) {
      return this.create(payload);
    },
    async patch(payload = {}) {
      if (!Object.hasOwn(payload || {}, "name")) {
        return {
          validatedObject: {},
          errors: {}
        };
      }
      return this.create(payload);
    },
    toJsonSchema() {
      return {
        type: "object"
      };
    }
  };
}

test("function schema returns normalized value when ok", async () => {
  const definition = {
    id: "tests.ok",
    version: 1,
    input: {
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
    input: {
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
    input: {
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

test("raw TypeBox action schemas validate input without reshaping it", async () => {
  const definition = {
    id: "tests.typebox",
    version: 1,
    input: {
      schema: Type.Object(
        {
          workspaceSlug: Type.String({ minLength: 1 })
        },
        { additionalProperties: false }
      )
    }
  };

  const result = await normalizeActionInput(definition, { workspaceSlug: "  ACME  " }, {});
  assert.deepEqual(result, { workspaceSlug: "  ACME  " });
});

test("typebox input validation normalizes pointer field errors to plain keys", async () => {
  const definition = {
    id: "tests.typebox.errors",
    version: 1,
    input: {
      schema: Type.Object(
        {
          name: Type.String({ maxLength: 1 })
        },
        { additionalProperties: false }
      )
    }
  };

  await assert.rejects(
    () => normalizeActionInput(definition, { name: "too long" }, {}),
    (error) => {
      const fieldErrors = error.details?.fieldErrors || {};
      assert.equal(typeof fieldErrors.name, "string");
      assert.equal(Object.hasOwn(fieldErrors, "/name"), false);
      return true;
    }
  );
});

test("action output validation does not reshape raw typebox output", async () => {
  const definition = {
    id: "tests.output",
    version: 1,
    output: {
      schema: Type.Object(
        {
          ok: Type.Boolean()
        },
        { additionalProperties: false }
      )
    }
  };

  await assert.rejects(
    () => normalizeActionOutput(definition, { ok: 1 }, {}),
    (error) => error?.code === "ACTION_OUTPUT_VALIDATION_FAILED"
  );

  const result = await normalizeActionOutput(definition, { ok: true }, {});
  assert.deepEqual(result, { ok: true });
});

test("json-rest-schema action validators normalize action input", async () => {
  const definition = {
    id: "tests.json-rest-schema",
    version: 1,
    input: {
      schema: createMockJsonRestSchema(),
      mode: "patch"
    }
  };

  const result = await normalizeActionInput(definition, { name: "  Acme  " }, {});
  assert.deepEqual(result, { name: "Acme" });
});

test("json-rest-schema action validators surface field errors", async () => {
  const definition = {
    id: "tests.json-rest-schema.errors",
    version: 1,
    input: {
      schema: createMockJsonRestSchema(),
      mode: "patch"
    }
  };

  await assert.rejects(
    () => normalizeActionInput(definition, { name: "   " }, {}),
    (error) => {
      assert.equal(error.code, "ACTION_VALIDATION_FAILED");
      assert.equal(error.details?.fieldErrors?.name, "Name is required.");
      return true;
    }
  );
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
        permissions: ["workspace.settings.*"]
      }
    )
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
          id: "user-7"
        },
        permissions: ["workspace.settings.update"]
      }
    )
  );
});
