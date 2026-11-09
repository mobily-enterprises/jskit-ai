import assert from "node:assert/strict";
import test from "node:test";
import { createFilterTyping, FILTER_TYPING_DELAY_MS } from "../src/client/composables/support/filterTypingSupport.js";

function typingOver(values) {
  const writes = [];
  const typing = createFilterTyping({
    read: (key) => values[key],
    write(key, value) {
      writes.push([key, value]);
      values[key] = value;
    }
  });
  return { typing, writes };
}

test("a typed filter value reaches the filter once the person pauses, not with every key", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const values = { weight: "" };
  const { typing, writes } = typingOver(values);

  for (const typed of ["1", "15", "150", "1500"]) {
    typing.type("weight", typed);
    t.mock.timers.tick(FILTER_TYPING_DELAY_MS - 1);
  }
  // The field shows what was typed while the filter still holds its value.
  assert.equal(typing.value("weight"), "1500");
  assert.deepEqual(writes, []);

  t.mock.timers.tick(1);
  assert.deepEqual(writes, [["weight", "1500"]]);
  assert.equal(typing.value("weight"), "1500");
});

test("Enter or leaving the field applies a typed value at once, and clearing applies at once", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const values = { supplierId: "4" };
  const { typing, writes } = typingOver(values);

  typing.type("supplierId", "42");
  typing.apply("supplierId");
  assert.deepEqual(writes, [["supplierId", "42"]]);
  t.mock.timers.tick(FILTER_TYPING_DELAY_MS);
  assert.deepEqual(writes, [["supplierId", "42"]]);

  typing.type("supplierId", null);
  assert.deepEqual(writes, [["supplierId", "42"], ["supplierId", null]]);

  typing.type("supplierId", "7");
  typing.applyAll();
  assert.deepEqual(writes.at(-1), ["supplierId", "7"]);
});
