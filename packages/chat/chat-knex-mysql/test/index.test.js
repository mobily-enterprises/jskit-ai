import assert from "node:assert/strict";
import test from "node:test";
import * as chatKnex from "../src/index.js";

test("chat knex mysql exports repository constructors", () => {
  assert.equal(typeof chatKnex.createThreadsRepository, "function");
  assert.equal(typeof chatKnex.createParticipantsRepository, "function");
  assert.equal(typeof chatKnex.createMessagesRepository, "function");
});
