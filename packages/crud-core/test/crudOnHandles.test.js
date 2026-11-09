import assert from "node:assert/strict";
import test from "node:test";
import { simplifyJsonApiResult } from "@jskit-ai/http-runtime/shared";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { passedOn } from "@jskit-ai/resource-runtime/server";
import { createPackageTestKnex, createTestResourceRuntime, startTestFeatures } from "@jskit-ai/resource-runtime/test";
import { defineFeature } from "@jskit-ai/kernel/server/features";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { defineCrudContract } from "@jskit-ai/resource-crud-core/shared/crudContract";
import { createCrudJsonApiActions } from "../src/server/jsonApiModule/actions.js";
import { createCrudService } from "../src/server/jsonApiModule/service.js";
import { CrudContractsProvider, createCrudContracts } from "../src/server/crudContracts.js";
import { defineCrudFeature } from "../src/server/defineCrudFeature.js";
import { crudJsonApiActionOptions } from "./support/crudJsonApiActionOptions.js";

// SQLite in memory, or a PostgreSQL schema of its own on a DB_CLIENT=pg run (see createPackageTestKnex).
const testKnex = (t) => createPackageTestKnex(t, { environment: process.env });

const WORKSPACE_ONE = Object.freeze({ scopeValues: Object.freeze({ workspaceId: "1" }) });

// 250 notes in workspace 1, read through json-rest-api's default page cap (100), with an audit table beside them.
async function createFixture(t) {
  const knex = await testKnex(t);
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
  const service = createCrudService({ repository, crud });
  const actionsFor = (options) => createCrudJsonApiActions(crudJsonApiActionOptions({
    namespace: "notes",
    resource: crud,
    repository,
    service,
    surface: "admin",
    permissionForOperation: () => ({ require: "authenticated" }),
    ...options
  }));
  return { knex, repository, audits: resources.noteAudits, crud, service, actionsFor };
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
async function createIncludeFixture(t, { authorOutput = "optional", authorsShow = { name: { output: "required" } } } = {}) {
  const knex = await testKnex(t);
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
  // The notes contract names the author but not the editor. The authors table's own contract, served to another
  // surface, shows more of each author than any include does.
  const crud = defineCrudContract(notes, {
    namespace: "notes",
    operations: ["list", "view"],
    fields: { title: { output: "required" }, authorId: { output: authorOutput } }
  });
  const contracts = createCrudContracts();
  contracts.register(crud);
  contracts.register(defineCrudContract(authors, { namespace: "authors", operations: ["list", "view"], fields: authorsShow }));
  contracts.seal();
  return createCrudService({ repository: resources.notes, crud });
}

test("a record a form saves back as the CRUD service showed it keeps its link to an author the writer cannot see, and a link to a missing author names that author", async (t) => {
  const knex = await testKnex(t);
  await knex.schema.createTable("authors", (table) => {
    table.increments("id");
    table.string("name").notNullable();
    table.boolean("retired").notNullable().defaultTo(false);
  });
  await knex.schema.createTable("notes", (table) => {
    table.increments("id");
    table.string("title").notNullable();
    table.integer("author_id");
  });
  await knex("authors").insert([{ name: "Ada", retired: false }, { name: "Grace", retired: true }]);
  await knex("notes").insert([{ title: "Draft", author_id: 2 }, { title: "Other", author_id: 2 }]);
  const authors = defineTableResource({
    name: "authors",
    tableName: "authors",
    ownership: "public",
    schema: { name: { type: "string", required: true }, retired: { type: "boolean", defaultTo: false } }
  });
  const notes = defineTableResource({
    name: "notes",
    tableName: "notes",
    ownership: "public",
    schema: {
      title: { type: "string", required: true },
      authorId: { type: "id", nullable: true, lookup: "authors", storage: { column: "author_id" } }
    }
  });
  const runtime = await createTestResourceRuntime({ knex });
  // A request sees only authors still writing, so a retired author's link reads as null.
  const resources = await runtime.own("test.notes", [notes, {
    resource: authors,
    rowPolicy: ({ query, column, caller }) => {
      if (caller.kind !== "system") query.where(column("retired"), false);
      return true;
    }
  }]);
  const crud = defineCrudContract(notes, {
    namespace: "notes",
    operations: ["list", "view", "patch"],
    fields: { title: { output: "required", patch: "optional" }, authorId: { output: "optional", patch: "optional" } }
  });
  const service = createCrudService({ repository: resources.notes, crud });
  const authorOf = async (id) => (await knex("notes").where({ id }).first("author_id")).author_id;

  const shown = simplifyJsonApiResult(await service.view("1", {}, {}));
  assert.equal(shown.authorId, null);
  await service.patch("1", { title: "Final", authorId: shown.authorId }, {});
  assert.deepEqual(await knex("notes").where({ id: 1 }).first("title", "author_id"), { title: "Final", author_id: 2 });
  // Linking an author the writer sees applies, and so does clearing that link.
  await service.patch("2", { authorId: "1" }, {});
  assert.equal(await authorOf(2), 1);
  await service.patch("2", { authorId: null }, {});
  assert.equal(await authorOf(2), null);
  // A link to an author that does not exist is refused as that author missing, not as the note missing.
  await assert.rejects(service.patch("2", { authorId: "99" }, {}), (error) => error.code === "REST_API_RESOURCE" &&
    error.subtype === "not_found" && error.details.resourceType === "authors" && error.details.resourceId === "99");
  await assert.rejects(service.patch("99", { title: "Gone" }, {}), { status: 404, code: "crud.document.notFound" });
});

test("an included record shows only its id, and a relationship the contract does not name is left out", async (t) => {
  const service = await createIncludeFixture(t, { authorsShow: { name: { output: "required" }, secretNote: { output: "optional" } } });
  const page = await service.list({ include: "author,editor" }, {});
  const view = await service.view("1", { include: "author,editor" }, {});
  for (const document of [page.value, view.value]) {
    const records = Array.isArray(document.data) ? document.data : [document.data];
    for (const record of records) {
      assert.deepEqual(Object.keys(record.attributes), ["title"]);
      assert.deepEqual(Object.keys(record.relationships), ["author"]);
    }
    // Grace is only the editor, which the contract does not name, so she is not included at all. Ada shows nothing
    // of the authors contract, which another surface serves with her secret note.
    assert.deepEqual(document.included.map(({ type, id, attributes }) => [type, id, attributes]), [["authors", "1", {}]]);
  }
});

test("an included record shows its lookup's label and the fields the including contract lists, never another contract's", async (t) => {
  const authorsShow = { name: { output: "required" }, secretNote: { output: "optional" } };
  const listed = await createIncludeFixture(t, { authorsShow, authorOutput: { required: false, includeFields: ["name"] } });
  assert.deepEqual((await listed.view("1", { include: "author" }, {})).value.included.map(({ attributes }) => attributes), [{ name: "Ada" }]);
  const labelled = await createIncludeFixture(t, { authorsShow, authorOutput: { required: false, relation: { kind: "lookup", namespace: "authors", valueKey: "id", labelKey: "name" } } });
  assert.deepEqual((await labelled.view("1", { include: "author" }, {})).value.included.map(({ attributes }) => attributes), [{ name: "Ada" }]);
  assert.throws(
    () => createCrudService({ repository: {}, crud: defineCrudContract(defineTableResource({ name: "cards", tableName: "cards", ownership: "public", schema: { authorId: { type: "id", lookup: "authors" } } }), { namespace: "cards", operations: ["view"], fields: { authorId: { output: { includeFields: "name" } } } }) }),
    /authorId\.includeFields must list the fields an included record shows/u
  );
  // The registry still keeps one contract per namespace.
  const contracts = createCrudContracts();
  const memos = defineTableResource({ name: "memos", tableName: "memos", ownership: "public", schema: { title: { type: "string", required: true } } });
  const memosCrud = defineCrudContract(memos, { namespace: "memos", operations: ["list", "view"], fields: { title: { output: "required" } } });
  contracts.register(memosCrud);
  contracts.register(memosCrud);
  assert.throws(
    () => contracts.register(defineCrudContract(memos, { namespace: "memos", operations: ["list"], fields: { title: { output: "required" } } })),
    /Two CRUD contracts are served under the namespace "memos"/u
  );
});

test("an include shows the records it links to only as deep, and only with the fields, as the including contract lists", async (t) => {
  const knex = await testKnex(t);
  await knex.schema.createTable("publishers", (table) => {
    table.increments("id");
    table.string("name").notNullable();
    table.string("secret");
  });
  await knex.schema.createTable("authors", (table) => {
    table.increments("id");
    table.string("name").notNullable();
    table.string("secret_note");
    table.integer("publisher_id");
  });
  await knex.schema.createTable("notes", (table) => {
    table.increments("id");
    table.string("title").notNullable();
    table.integer("author_id");
  });
  await knex("publishers").insert({ name: "Acme", secret: "private" });
  await knex("authors").insert({ name: "Ada", secret_note: "private", publisher_id: 1 });
  await knex("notes").insert({ title: "First", author_id: 1 });
  const publishers = defineTableResource({
    name: "publishers",
    tableName: "publishers",
    ownership: "public",
    schema: { name: { type: "string", required: true }, secret: { type: "string", nullable: true } }
  });
  const authors = defineTableResource({
    name: "authors",
    tableName: "authors",
    ownership: "public",
    schema: {
      name: { type: "string", required: true },
      secretNote: { type: "string", nullable: true, storage: { column: "secret_note" } },
      publisherId: { type: "id", nullable: true, lookup: "publishers", storage: { column: "publisher_id" } }
    }
  });
  const notes = defineTableResource({
    name: "notes",
    tableName: "notes",
    ownership: "public",
    schema: { title: { type: "string", required: true }, authorId: { type: "id", nullable: true, lookup: "authors", storage: { column: "author_id" } } }
  });
  const runtime = await createTestResourceRuntime({ knex });
  const resources = await runtime.own("test.notes", [notes, authors, publishers]);
  const serve = (includeFields) => createCrudService({
    repository: resources.notes,
    crud: defineCrudContract(notes, { namespace: "notes", operations: ["view"], fields: { title: { output: "required" }, authorId: { output: { required: false, includeFields } } } })
  });
  const shown = async (includeFields) => (await serve(includeFields).view("1", { include: "author,author.publisher" }, {})).value.included
    .map(({ type, attributes, relationships }) => [type, attributes, Object.keys(relationships ?? {})]);

  assert.deepEqual(await shown(["name", { publisher: ["name"] }]), [["authors", { name: "Ada" }, ["publisher"]], ["publishers", { name: "Acme" }, []]]);
  // A level-2 field shows only when the including contract lists it.
  assert.deepEqual(await shown(["name", { publisher: ["name", "secret"] }]), [["authors", { name: "Ada" }, ["publisher"]], ["publishers", { name: "Acme", secret: "private" }, []]]);
  // A nested record the contract does not list is not answered, and the link to it is left out.
  assert.deepEqual(await shown(["name"]), [["authors", { name: "Ada" }, []]]);
  assert.deepEqual(await shown([{ publisher: [] }]), [["authors", {}, ["publisher"]], ["publishers", {}, []]]);
  for (const malformed of [[{ publisher: "name" }], [""], [{}]]) {
    assert.throws(() => serve(malformed), /authorId\.includeFields(\.publisher)? must list the fields an included record shows/u);
  }
});

test("an include that lists a link of the included record as a field is refused at boot, naming the link's form, which answers the linked id", async (t) => {
  const publishers = defineTableResource({
    name: "publishers",
    tableName: "publishers",
    ownership: "public",
    schema: {
      name: { type: "string", required: true },
      founderId: { type: "id", nullable: true, lookup: "authors", storage: { column: "founder_id" } }
    }
  });
  const authors = defineTableResource({
    name: "authors",
    tableName: "authors",
    ownership: "public",
    schema: {
      name: { type: "string", required: true },
      publisherId: { type: "id", nullable: true, lookup: "publishers", storage: { column: "publisher_id" } }
    }
  });
  const notes = defineTableResource({
    name: "notes",
    tableName: "notes",
    ownership: "public",
    schema: { title: { type: "string", required: true }, authorId: { type: "id", nullable: true, lookup: "authors", storage: { column: "author_id" } } }
  });
  // The notes feature serves the notes; another feature owns the tables its include reaches.
  const start = async (includeFields) => {
    const knex = await testKnex(t);
    const started = await startTestFeatures({
      knex,
      features: [
        CrudContractsProvider,
        defineFeature({ id: "test.authors", owns: [authors, publishers], setup: () => ({}) }),
        defineCrudFeature({
          crud: defineCrudContract(notes, { namespace: "notes", operations: ["view"], fields: { title: { output: "required" }, authorId: { output: { required: false, includeFields } } } }),
          surface: "home",
          routes: false
        })
      ],
      requires: { notes: "crud.notes" },
      inputs: { "runtime.http": { router: { register() {} } } },
      createTables: true
    });
    t.after(started.stop);
    return { knex, service: started.capabilities.notes.service };
  };

  // A belongs-to field is a relationship in a JSON:API document, so listed as a field, by its key or by its
  // relationship, it would never show: the boot refuses it, at every depth, and names the form that shows it.
  for (const [includeFields, label, named, form] of [
    [["name", "publisherId"], "authorId.includeFields", "publisherId", "{ publisher: [] }"],
    [["publisher"], "authorId.includeFields", "publisher", "{ publisher: [] }"],
    [["name", { publisher: ["name", "founderId"] }], "authorId.includeFields.publisher", "founderId", "{ founder: [] }"]
  ]) {
    await assert.rejects(start(includeFields), (error) => {
      assert.ok(error instanceof TypeError);
      assert.ok(error.message.startsWith(`A CRUD contract's ${label} lists "${named}", which is a link of `), error.message);
      assert.ok(error.message.includes(`List it as ${form}`), error.message);
      return true;
    });
  }

  // Listed as a link, it shows: the included author answers its publisher's id, and nothing of the publisher.
  const { knex, service } = await start(["name", { publisher: [] }]);
  await knex("publishers").insert({ name: "Acme" });
  await knex("authors").insert({ name: "Ada", publisher_id: 1 });
  await knex("notes").insert({ title: "First", author_id: 1 });
  const { included } = (await service.view("1", { include: "author" }, {})).value;
  assert.deepEqual(included.map(({ type, attributes, relationships }) => [type, attributes, relationships.publisher.data]), [
    ["authors", { name: "Ada" }, { type: "publishers", id: "1" }]
  ]);
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

test("a repository decorator receives only the context, the transaction and the document format", async (t) => {
  const { repository, audits, crud } = await createFixture(t);
  const received = [];
  // A decorator that also reads another table hands it only { context, trx }, so that read keeps its own rules.
  const decorated = Object.freeze({
    ...repository,
    async get(id, params, options) {
      received.push(Object.keys(options).sort());
      await assert.rejects(audits.get("999", {}, passedOn(options)), (error) => error.code === "REST_API_RESOURCE" && error.subtype === "not_found");
      return repository.get(id, params, options);
    },
    async delete(id, options) {
      received.push(Object.keys(options).sort());
      return repository.delete(id, options);
    }
  });
  const service = createCrudService({ repository: decorated, crud });
  assert.equal((await service.view("7", {}, { context: WORKSPACE_ONE })).value.data.attributes.title, "Note 7");
  await assert.rejects(service.view("999", {}, { context: WORKSPACE_ONE }), { status: 404, code: "crud.document.notFound" });
  assert.equal(await service.delete("999", { context: WORKSPACE_ONE }), null);
  assert.equal(await service.delete("8", { context: WORKSPACE_ONE }), "8");
  await repository.withTransaction({ context: WORKSPACE_ONE }, (txOptions) => service.view("7", {}, txOptions));
  assert.deepEqual(received, [
    ["context", "format"],
    ["context", "format"],
    ["context"],
    ["context"],
    ["context", "format", "trx"]
  ]);
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
  const knex = await testKnex(t);
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
  const service = createCrudService({
    repository,
    crud: defineCrudContract(memos, { namespace: "memos", fields: { title: { output: "required", create: "required", patch: "optional" } } })
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
