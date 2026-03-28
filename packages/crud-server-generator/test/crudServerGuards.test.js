import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createTemplateServerFixture } from "../test-support/templateServerFixture.js";

const fixture = await createTemplateServerFixture();
const { createActions } = await fixture.importServerModule("actions.js");
const { createRepository } = await fixture.importServerModule("repository.js");

after(async () => {
  await fixture.cleanup();
});

test("template createRepository requires explicit tableName", () => {
  const knex = () => {
    throw new Error("not expected");
  };

  assert.throws(
    () => createRepository(knex, {}),
    /requires tableName/
  );
});

test("template createActions requires explicit surface", () => {
  assert.throws(
    () => createActions({}),
    /requires a non-empty surface/
  );
});
