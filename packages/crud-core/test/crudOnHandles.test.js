import assert from "node:assert/strict";
import test from "node:test";
import knexLib from "knex";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { createTestResourceRuntime } from "@jskit-ai/resource-runtime/test";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { defineCrudContract } from "@jskit-ai/resource-crud-core/shared/crudContract";
import { createCrudJsonApiActions } from "../src/server/jsonApiModule/actions.js";
import { createCrudService } from "../src/server/jsonApiModule/service.js";
import { createCrudContracts } from "../src/server/crudContracts.js";
import { crudJsonApiActionOptions } from "./support/crudJsonApiActionOptions.js";

const WORKSPACE_ONE = Object.freeze({ scopeValues: Object.freeze({ workspaceId: "1" }) });

// 250 notes in workspace 1, read through json-rest-api's default page cap (100), with an audit table beside them.
async function createFixture(t) {
  const knex = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => knex.destroy());
  await knex.schema.createTable("notes", (table) => {
    table.increments("id");
    table.integer("workspace_id").notNullable();
    table.string("title").notNullable();
    table.string("internal_note");
  });
  await knex.schema.createTable("note_audits", (table) => {
    table.increments("id");
    table.integer("workspace_id").notNullable();
    table.string("message").notNullable();
  });
  await knex.batchInsert("notes", Array.from({ length: 250 }, (_, index) => ({
    workspace_id: 1,
    title: `Note ${index + 1}`,
    internal_note: "staff only"
  })), 100);
  const notes = defineTableResource({
    name: "notes",
    tableName: "notes",
    ownership: "workspace",
    schema: {
      workspaceId: { type: "id", storage: { column: "workspace_id" } },
      title: { type: "string", required: true, search: true },
      // A column the contract below does not name.
      internalNote: { type: "string", nullable: true, storage: { column: "internal_note" } }
    }
  });
  const audits = defineTableResource({
    name: "noteAudits",
    tableName: "note_audits",
    ownership: "workspace",
    schema: {
      workspaceId: { type: "id", storage: { column: "workspace_id" } },
      message: { type: "string", required: true }
    }
  });
  const runtime = await createTestResourceRuntime({ knex });
  const resources = await runtime.own("test.notes", [notes, audits]);
  const repository = resources.notes;
  const crud = defineCrudContract(notes, {
    namespace: "notes",
    fields: { title: { output: "required", create: "required", patch: "optional" } }
  });
  const contracts = createCrudContracts();
  contracts.register(crud);
  contracts.seal();
  const service = createCrudService({ repository, crud, contracts });
  const actionsFor = (options) => createCrudJsonApiActions(crudJsonApiActionOptions({
    namespace: "notes",
    resource: crud,
    repository,
    service,
    surface: "admin",
    permissionForOperation: () => ({ require: "authenticated" }),
    ...options
  }));
  return { knex, repository, audits: resources.noteAudits, service, actionsFor };
}

test("the list action keeps answering a larger limit with one capped page", async (t) => {
  const { repository, actionsFor } = await createFixture(t);
  assert.equal(repository.pageLimits().request, 100);
  const [list] = actionsFor({ operations: ["list"] });

  for (const limit of [500, "250", 100]) {
    const result = await list.execute({ limit }, WORKSPACE_ONE);
    assert.equal(result.value.data.length, 100, `limit ${limit}`);
    assert.equal(result.value.meta.pagination.pageSize, 100, `limit ${limit}`);
    assert.equal(result.value.meta.pagination.hasMore, true, `limit ${limit}`);
    assert.equal(typeof result.value.meta.pagination.cursor.next, "string");
  }
  const first = await list.execute({ limit: 20 }, WORKSPACE_ONE);
  assert.equal(first.value.data.length, 20);
  // A cursor alone pages on at json-rest-api's default page size.
  const next = await list.execute({ cursor: first.value.meta.pagination.cursor.next }, WORKSPACE_ONE);
  assert.equal(next.value.data[0].attributes.title, "Note 21");
});

test("a column the contract does not name is neither returned nor accepted", async (t) => {
  const { knex, actionsFor } = await createFixture(t);
  const [list, view, create, update] = actionsFor({ operations: ["list", "view", "create", "update"] });
  const page = await list.execute({ limit: 5 }, WORKSPACE_ONE);
  assert.deepEqual(page.value.data.map(({ attributes }) => Object.keys(attributes)), Array(5).fill(["title"]));
  assert.deepEqual(Object.keys((await view.execute({ recordId: "1" }, WORKSPACE_ONE)).value.data.attributes), ["title"]);
  const created = await create.execute({ title: "New" }, WORKSPACE_ONE);
  assert.deepEqual(Object.keys(created.value.data.attributes), ["title"]);
  const updated = await update.execute({ recordId: "1", title: "Renamed" }, WORKSPACE_ONE);
  assert.deepEqual(Object.keys(updated.value.data.attributes), ["title"]);
  // The action runtime validates each input against the action's input before execute runs.
  for (const [action, input] of [[create, { title: "New" }], [update, { recordId: "1" }]]) {
    assert.throws(() => validateSchemaPayload(action.input, { ...input, internalNote: "set by a request" }, { phase: "input" }),
      (error) => Object.hasOwn(error.fieldErrors || {}, "internalNote"), action.operation);
  }
  assert.equal((await knex("notes").where({ id: 1 }).first()).internal_note, "staff only");
});

// Notes, each by an author and with an editor, both authors; the authors table keeps a column no contract names.
async function createIncludeFixture(t, { authorsServed = true } = {}) {
  const knex = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => knex.destroy());
  await knex.schema.createTable("authors", (table) => {
    table.increments("id");
    table.string("name").notNullable();
    table.string("secret_note");
  });
  await knex.schema.createTable("notes", (table) => {
    table.increments("id");
    table.string("title").notNullable();
    table.integer("author_id");
    table.integer("editor_id");
  });
  await knex("authors").insert([{ name: "Ada", secret_note: "private" }, { name: "Grace", secret_note: "private" }]);
  await knex("notes").insert([{ title: "First", author_id: 1, editor_id: 2 }, { title: "Second", author_id: 1, editor_id: 2 }]);
  const authors = defineTableResource({
    name: "authors",
    tableName: "authors",
    ownership: "public",
    schema: {
      name: { type: "string", required: true },
      secretNote: { type: "string", nullable: true, storage: { column: "secret_note" } }
    }
  });
  const notes = defineTableResource({
    name: "notes",
    tableName: "notes",
    ownership: "public",
    schema: {
      title: { type: "string", required: true },
      authorId: { type: "id", nullable: true, lookup: "authors", storage: { column: "author_id" } },
      editorId: { type: "id", nullable: true, lookup: "authors", storage: { column: "editor_id" } }
    }
  });
  const runtime = await createTestResourceRuntime({ knex });
  const resources = await runtime.own("test.notes", [notes, authors]);
  // The notes contract names the author but not the editor; the authors contract shows the name only.
  const crud = defineCrudContract(notes, {
    namespace: "notes",
    operations: ["list", "view"],
    fields: { title: { output: "required" }, authorId: { output: "optional" } }
  });
  const contracts = createCrudContracts();
  contracts.register(crud);
  if (authorsServed) {
    contracts.register(defineCrudContract(authors, { namespace: "authors", operations: ["list", "view"], fields: { name: { output: "required" } } }));
  }
  contracts.seal();
  return createCrudService({ repository: resources.notes, crud, contracts });
}

test("an included record shows only what its own contract shows, and a relationship the contract does not name is left out", async (t) => {
  const service = await createIncludeFixture(t);
  const page = await service.list({ include: "author,editor" }, {});
  const view = await service.view("1", { include: "author,editor" }, {});
  for (const document of [page.value, view.value]) {
    const records = Array.isArray(document.data) ? document.data : [document.data];
    for (const record of records) {
      assert.deepEqual(Object.keys(record.attributes), ["title"]);
      assert.deepEqual(Object.keys(record.relationships), ["author"]);
    }
    // Grace is only the editor, which the contract does not name, so she is not included at all.
    assert.deepEqual(document.included.map(({ type, id, attributes }) => [type, id, attributes]), [["authors", "1", { name: "Ada" }]]);
  }
});

test("an included record of a table no contract serves shows only its id", async (t) => {
  const service = await createIncludeFixture(t, { authorsServed: false });
  const { value } = await service.view("1", { include: "author" }, {});
  assert.deepEqual(value.included.map(({ type, id, attributes }) => [type, id, attributes]), [["authors", "1", {}]]);
});

test("the CRUD service answers documents, and 404 for a record that is missing or out of scope", async (t) => {
  const { service } = await createFixture(t);
  const page = await service.list({ title: "Note 7", fields: { notes: ["title"] } }, { context: WORKSPACE_ONE });
  assert.deepEqual(page.value.data.map(({ id, attributes }) => [id, attributes]), [["7", { title: "Note 7" }]]);
  assert.equal((await service.view("7", {}, { context: WORKSPACE_ONE })).value.data.attributes.title, "Note 7");
  const otherWorkspace = Object.freeze({ scopeValues: Object.freeze({ workspaceId: "2" }) });
  for (const run of [
    () => service.view("7", {}, { context: otherWorkspace }),
    () => service.patch("7", { title: "Taken" }, { context: otherWorkspace }),
    () => service.view("999", {}, { context: WORKSPACE_ONE })
  ]) {
    await assert.rejects(run, { status: 404, code: "crud.document.notFound" });
  }
  assert.equal(await service.delete("999", { context: WORKSPACE_ONE }), null);
});

test("a mutation's hooks and its standard write share one transaction and roll back together", async (t) => {
  const { knex, audits, actionsFor } = await createFixture(t);
  const lifecycle = (fail) => ({
    update: {
      async after({ input, options }) {
        await audits.create({ message: `Renamed ${input.recordId}` }, options);
        if (fail) {
          throw new Error("Abandon the rename");
        }
      }
    }
  });
  const [update] = actionsFor({ operations: ["update"], operationLifecycle: lifecycle(true) });
  await assert.rejects(update.execute({ recordId: "1", title: "Renamed" }, WORKSPACE_ONE), /Abandon the rename/u);
  assert.equal((await knex("notes").where({ id: 1 }).first()).title, "Note 1");
  assert.deepEqual(await knex("note_audits"), []);

  const [kept] = actionsFor({ operations: ["update"], operationLifecycle: lifecycle(false) });
  await kept.execute({ recordId: "1", title: "Renamed" }, WORKSPACE_ONE);
  assert.equal((await knex("notes").where({ id: 1 }).first()).title, "Renamed");
  assert.deepEqual(await knex("note_audits").pluck("message"), ["Renamed 1"]);
});

test("a failing CRUD afterCommit hook reports committed and leaves the actual write stored", async (t) => {
  const { knex, actionsFor } = await createFixture(t);
  const failure = Object.freeze(new Error("Notification failed"));
  const [update] = actionsFor({
    operations: ["update"],
    operationLifecycle: { update: { afterCommit() { throw failure; } } }
  });
  await assert.rejects(
    () => update.execute({ recordId: "1", title: "Kindred" }, WORKSPACE_ONE),
    (error) => error.transactionOutcome === "committed" && error.cause === failure
  );
  assert.equal((await knex("notes").where({ id: 1 }).first()).title, "Kindred");
});

test("the CRUD service's writes are stamped with createdAt and updatedAt when the table stores them", async (t) => {
  const knex = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => knex.destroy());
  await knex.schema.createTable("memos", (table) => {
    table.increments("id");
    table.string("title").notNullable();
    table.string("created_at").notNullable();
    table.string("updated_at").notNullable();
  });
  const memos = defineTableResource({
    name: "memos",
    tableName: "memos",
    ownership: "public",
    schema: {
      title: { type: "string", required: true },
      createdAt: { type: "dateTime", storage: { column: "created_at", writeSerializer: "datetime-utc" } },
      updatedAt: { type: "dateTime", storage: { column: "updated_at", writeSerializer: "datetime-utc" } }
    }
  });
  const runtime = await createTestResourceRuntime({ knex });
  const { memos: repository } = await runtime.own("test.memos", [memos]);
  const contracts = createCrudContracts();
  contracts.seal();
  const service = createCrudService({
    repository,
    crud: defineCrudContract(memos, { namespace: "memos", fields: { title: { output: "required", create: "required", patch: "optional" } } }),
    contracts
  });
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-08T01:02:03.000Z") });

  const created = await service.create({ title: "First" }, {});
  const id = created.value.data.id;
  const stored = async () => knex("memos").where({ id }).first("created_at", "updated_at");
  assert.deepEqual(await stored(), { created_at: "2026-11-08 01:02:03.000", updated_at: "2026-11-08 01:02:03.000" });

  t.mock.timers.setTime(Date.parse("2026-11-08T05:06:07.000Z"));
  await service.patch(id, { title: "Second" }, {});
  assert.deepEqual(await stored(), { created_at: "2026-11-08 01:02:03.000", updated_at: "2026-11-08 05:06:07.000" });

  // A request, which carries its context, cannot set them: a create body's createdAt and a patch body's updatedAt
  // give way to the server's time.
  const request = { context: {} };
  const forged = await service.create({ title: "Forged", createdAt: "2020-01-02T03:04:05.000Z" }, request);
  const forgedId = forged.value.data.id;
  await service.patch(forgedId, { title: "Forged again", updatedAt: "2020-01-02T03:04:05.000Z" }, request);
  assert.deepEqual(await knex("memos").where({ id: forgedId }).first("created_at", "updated_at"),
    { created_at: "2026-11-08 05:06:07.000", updated_at: "2026-11-08 05:06:07.000" });
});
