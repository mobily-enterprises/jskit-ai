import assert from "node:assert/strict";
import test from "node:test";
import * as transcriptsKnex from "../src/index.js";

test("assistant transcripts knex mysql exports repository constructors", () => {
  assert.equal(typeof transcriptsKnex.createConversationsRepository, "function");
  assert.equal(typeof transcriptsKnex.createMessagesRepository, "function");
});
