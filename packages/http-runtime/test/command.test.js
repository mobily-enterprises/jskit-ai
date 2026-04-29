import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";
import { createCommand } from "../src/shared/validators/command.js";

test("createCommand requires input/output schema objects", () => {
  assert.throws(() => createCommand({}), /input must be a schema object/);

  assert.throws(
    () =>
      createCommand({
        input: createSchema({})
      }),
    /output must be a schema object/
  );
});

test("createCommand normalizes invalidates and preserves idempotent flag", () => {
  const command = createCommand({
    input: createSchema({
      token: { type: "string", required: true, minLength: 1 }
    }),
    output: createSchema({
      ok: { type: "boolean", required: true }
    }),
    idempotent: true,
    invalidates: ["users-web", "users-web", "", "workspace.members"]
  });

  assert.equal(command.idempotent, true);
  assert.deepEqual(command.invalidates, ["users-web", "workspace.members"]);
  assert.equal(typeof command.input.toJsonSchema, "function");
  assert.equal(typeof command.output.toJsonSchema, "function");
});

test("createCommand omits idempotent when not explicitly boolean", () => {
  const command = createCommand({
    input: createSchema({}),
    output: createSchema({})
  });

  assert.equal(Object.hasOwn(command, "idempotent"), false);
});
