import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";
import { createCommand } from "../src/shared/validators/command.js";

test("createCommand requires input/output schema definitions", () => {
  assert.throws(() => createCommand({}), /input is required/);

  assert.throws(
    () =>
      createCommand({
        input: {
          schema: createSchema({})
        }
      }),
    /output is required/
  );

  assert.throws(
    () =>
      createCommand({
        input: createSchema({}),
        output: {
          schema: createSchema({})
        }
      }),
    /input must be a schema definition object/
  );
});

test("createCommand normalizes invalidates and preserves idempotent flag", () => {
  const command = createCommand({
    input: {
      schema: createSchema({
        token: { type: "string", required: true, minLength: 1 }
      })
    },
    output: {
      schema: createSchema({
        ok: { type: "boolean", required: true }
      })
    },
    idempotent: true,
    invalidates: ["users-web", "users-web", "", "workspace.members"]
  });

  assert.equal(command.idempotent, true);
  assert.deepEqual(command.invalidates, ["users-web", "workspace.members"]);
  assert.equal(command.input.mode, "patch");
  assert.equal(command.output.mode, "replace");
  assert.equal(typeof command.input.schema.toJsonSchema, "function");
  assert.equal(typeof command.output.schema.toJsonSchema, "function");
});

test("createCommand omits idempotent when not explicitly boolean", () => {
  const command = createCommand({
    input: {
      schema: createSchema({})
    },
    output: {
      schema: createSchema({})
    }
  });

  assert.equal(Object.hasOwn(command, "idempotent"), false);
});
