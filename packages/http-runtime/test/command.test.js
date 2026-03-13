import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "@fastify/type-provider-typebox";
import { createCommand } from "../src/shared/validators/command.js";

test("createCommand requires input/output TypeBox schemas", () => {
  assert.throws(() => createCommand({}), /input must be a TypeBox schema object/);

  assert.throws(
    () =>
      createCommand({
        input: Type.Object({}, { additionalProperties: false })
      }),
    /output must be a TypeBox schema object/
  );
});

test("createCommand normalizes invalidates and preserves idempotent flag", () => {
  const command = createCommand({
    input: Type.Object(
      {
        token: Type.String({ minLength: 1 })
      },
      { additionalProperties: false }
    ),
    output: Type.Object(
      {
        ok: Type.Boolean()
      },
      { additionalProperties: false }
    ),
    idempotent: true,
    invalidates: ["users-web", "users-web", "", "workspace.members"]
  });

  assert.equal(command.idempotent, true);
  assert.deepEqual(command.invalidates, ["users-web", "workspace.members"]);
  assert.equal(command.input.type, "object");
  assert.equal(command.output.type, "object");
});

test("createCommand omits idempotent when not explicitly boolean", () => {
  const command = createCommand({
    input: Type.Object({}, { additionalProperties: false }),
    output: Type.Object({}, { additionalProperties: false })
  });

  assert.equal(Object.hasOwn(command, "idempotent"), false);
});
