import test from "node:test";
import assert from "node:assert/strict";
import { crudResource } from "../src/shared/crud/crudResource.js";

test("crudResource normalizes create payload", () => {
  const normalized = crudResource.operations.create.bodyValidator.normalize({
    textField: "  Example text  ",
    dateField: "2026-03-11",
    numberField: "42.5"
  });

  assert.deepEqual(normalized, {
    textField: "Example text",
    dateField: "2026-03-11 00:00:00.000",
    numberField: 42.5
  });
});

test("crudResource normalizes list output", () => {
  const normalized = crudResource.operations.list.outputValidator.normalize({
    items: [
      {
        id: "7",
        textField: " Example text ",
        dateField: "2026-03-10",
        numberField: "99",
        createdAt: "2026-03-11 00:00:00.000",
        updatedAt: "2026-03-11 00:00:00.000"
      }
    ],
    nextCursor: " 8 "
  });

  assert.equal(normalized.items[0].id, 7);
  assert.equal(normalized.items[0].textField, "Example text");
  assert.equal(normalized.items[0].dateField, "2026-03-10T00:00:00.000Z");
  assert.equal(normalized.items[0].numberField, 99);
  assert.match(normalized.items[0].createdAt, /T/);
  assert.match(normalized.items[0].updatedAt, /T/);
  assert.equal(normalized.nextCursor, "8");
});
