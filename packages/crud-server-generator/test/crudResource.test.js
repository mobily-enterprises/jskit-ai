import test from "node:test";
import assert from "node:assert/strict";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { crudResource } from "../src/shared/crud/crudResource.js";

test("crudResource normalizes create payload through schema validation", async () => {
  const normalized = await validateSchemaPayload(crudResource.operations.create.body, {
    textField: "  Example text  ",
    dateField: "2026-03-11",
    numberField: "42.5"
  }, { phase: "input" });

  assert.equal(normalized.textField, "Example text");
  assert.equal(normalized.numberField, 42.5);
  assert.ok(normalized.dateField instanceof Date);
  assert.equal(normalized.dateField.toISOString(), "2026-03-11T00:00:00.000Z");
});

test("crudResource normalizes record output through schema validation", async () => {
  const normalized = await validateSchemaPayload(crudResource.operations.view.output, {
    id: 7,
    textField: " Example text ",
    dateField: "2026-03-10",
    numberField: "99",
    createdAt: "2026-03-11 00:00:00.000",
    updatedAt: "2026-03-11 00:00:00.000"
  }, { phase: "output" });

  assert.equal(normalized.id, "7");
  assert.equal(normalized.textField, "Example text");
  assert.ok(normalized.dateField instanceof Date);
  assert.equal(normalized.dateField.toISOString(), "2026-03-10T00:00:00.000Z");
  assert.equal(normalized.numberField, 99);
  assert.ok(normalized.createdAt instanceof Date);
  assert.ok(normalized.updatedAt instanceof Date);
});

test("crudResource list operation exposes output validator only", () => {
  assert.equal(crudResource.operations.list.output?.normalize, undefined);
  assert.equal(crudResource.operations.list.input, undefined);
  assert.deepEqual(crudResource.operations.list.realtime?.events, ["crud.record.changed"]);
});
