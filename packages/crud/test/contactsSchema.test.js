import test from "node:test";
import assert from "node:assert/strict";
import { contactsSchema } from "../src/shared/contacts/contactsSchema.js";

test("contactsSchema normalizes create payload", () => {
  const normalized = contactsSchema.operations.create.body.normalize({
    name: "  Ada  ",
    surname: "  Lovelace  "
  });

  assert.deepEqual(normalized, {
    name: "Ada",
    surname: "Lovelace"
  });
});

test("contactsSchema normalizes list output", () => {
  const normalized = contactsSchema.operations.list.output.normalize({
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
