import test from "node:test";
import assert from "node:assert/strict";
import { crudResource } from "../src/shared/crud/crudResource.js";

test("crudResource normalizes create payload", () => {
  const normalized = crudResource.operations.create.body.normalize({
    name: "  Ada  ",
    surname: "  Lovelace  "
  });

  assert.deepEqual(normalized, {
    name: "Ada",
    surname: "Lovelace"
  });
});

test("crudResource normalizes list output", () => {
  const normalized = crudResource.operations.list.output.normalize({
    items: [
      {
        id: "7",
        name: " Ada ",
        surname: " Lovelace ",
        createdAt: "2026-03-11T00:00:00.000Z",
        updatedAt: "2026-03-11T00:00:00.000Z"
      }
    ],
    nextCursor: " 8 "
  });

  assert.equal(normalized.items[0].id, 7);
  assert.equal(normalized.items[0].name, "Ada");
  assert.equal(normalized.items[0].surname, "Lovelace");
  assert.equal(normalized.nextCursor, "8");
});
