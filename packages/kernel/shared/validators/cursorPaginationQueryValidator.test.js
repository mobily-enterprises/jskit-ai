import test from "node:test";
import assert from "node:assert/strict";
import { cursorPaginationQueryValidator } from "./cursorPaginationQueryValidator.js";
import { validateSchemaPayload } from "./schemaPayloadValidation.js";

test("cursorPaginationQueryValidator normalizes numeric strings through schema casting", async () => {
  assert.deepEqual(await validateSchemaPayload(cursorPaginationQueryValidator, { cursor: "12", limit: "25" }), {
    cursor: 12,
    limit: 25
  });
});

test("cursorPaginationQueryValidator schema rejects opaque cursor strings", () => {
  const transportSchema = cursorPaginationQueryValidator.schema.toJsonSchema({ mode: "patch" });
  assert.equal(
    Array.isArray(transportSchema.properties.cursor.type) &&
      transportSchema.properties.cursor.pattern === "^[1-9][0-9]*$",
    true
  );
});

test("cursorPaginationQueryValidator keeps absent keys absent", async () => {
  assert.deepEqual(await validateSchemaPayload(cursorPaginationQueryValidator, {}), {});
});

test("cursorPaginationQueryValidator rejects unsupported query fields", async () => {
  await assert.rejects(
    () => validateSchemaPayload(cursorPaginationQueryValidator, { q: "  to  " }),
    (error) => {
      assert.deepEqual(error.fieldErrors, {
        q: "Field not allowed"
      });
      return true;
    }
  );
});
