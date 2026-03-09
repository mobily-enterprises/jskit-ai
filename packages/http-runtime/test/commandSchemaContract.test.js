import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "@fastify/type-provider-typebox";
import { createCommandContract } from "../src/shared/contracts/commandSchemaContract.js";

test("createCommandContract requires input/output TypeBox schemas", () => {
  assert.throws(() => createCommandContract({}), /input must be a TypeBox schema object/);

  assert.throws(
    () =>
      createCommandContract({
        input: Type.Object({}, { additionalProperties: false })
      }),
    /output must be a TypeBox schema object/
  );
});

test("createCommandContract normalizes invalidates and preserves idempotent flag", () => {
  const contract = createCommandContract({
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

  assert.equal(contract.idempotent, true);
  assert.deepEqual(contract.invalidates, ["users-web", "workspace.members"]);
  assert.equal(contract.input.type, "object");
  assert.equal(contract.output.type, "object");
});

test("createCommandContract omits idempotent when not explicitly boolean", () => {
  const contract = createCommandContract({
    input: Type.Object({}, { additionalProperties: false }),
    output: Type.Object({}, { additionalProperties: false })
  });

  assert.equal(Object.hasOwn(contract, "idempotent"), false);
});
