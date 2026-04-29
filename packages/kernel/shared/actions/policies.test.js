import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";

import { ensureActionPermissionAllowed, normalizeActionInput, normalizeActionOutput } from "./policies.js";

test("plain json-rest-schema action schemas validate input without reshaping it", async () => {
  const definition = {
    id: "tests.schema",
    version: 1,
    input: {
      schema: createSchema({
        workspaceSlug: {
          type: "string",
          required: true,
          minLength: 1
        }
      }),
      mode: "replace"
    }
  };

  const result = await normalizeActionInput(definition, { workspaceSlug: "  ACME  " }, {});
  assert.deepEqual(result, { workspaceSlug: "ACME" });
});

test("json-rest-schema input validation surfaces plain field keys", async () => {
  const definition = {
    id: "tests.schema.errors",
    version: 1,
    input: {
      schema: createSchema({
        name: {
          type: "string",
          required: true,
          maxLength: 1
        }
      }),
      mode: "replace"
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

test("action output validation preserves valid json-rest-schema output", async () => {
  const definition = {
    id: "tests.output",
    version: 1,
    output: {
      schema: createSchema({
        ok: {
          type: "boolean",
          required: true
        }
      }),
      mode: "replace"
    }
  };

  await assert.rejects(
    () => normalizeActionOutput(definition, { ok: 2 }, {}),
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
      schema: createSchema({
        name: {
          type: "string",
          required: true,
          minLength: 1,
          messages: {
            minLength: "Name is required."
          }
        }
      }),
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
      schema: createSchema({
        name: {
          type: "string",
          required: true,
          minLength: 1,
          messages: {
            minLength: "Name is required."
          }
        }
      }),
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
