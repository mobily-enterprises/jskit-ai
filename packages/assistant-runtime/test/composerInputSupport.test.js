import assert from "node:assert/strict";
import test from "node:test";
import { insertTextAtSelection } from "../src/client/support/composerInputSupport.js";

test("insertTextAtSelection inserts a line break at the caret", () => {
  const result = insertTextAtSelection("hello world", 5, 5, "\n");

  assert.deepEqual(result, {
    value: "hello\n world",
    selectionStart: 6,
    selectionEnd: 6
  });
});

test("insertTextAtSelection replaces the active selection with a line break", () => {
  const result = insertTextAtSelection("hello world", 5, 11, "\n");

  assert.deepEqual(result, {
    value: "hello\n",
    selectionStart: 6,
    selectionEnd: 6
  });
});
