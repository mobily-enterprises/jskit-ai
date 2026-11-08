import assert from "node:assert/strict";
import test from "node:test";
import knexLib from "knex";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { countQueries } from "@jskit-ai/database-runtime/server/testDatabases";
import { withoutHiddenFields } from "../src/server/index.js";
import { createTestResourceRuntime } from "../src/test/index.js";

const WORKSPACE_A = Object.freeze({ workspace: { id: "1" } });

// Cards with a hidden owner, a hidden bearer token, a hidden flag, a hidden count and a hidden time: two in workspace
// 1 and one in workspace 2.
async function createCardFixture(t) {
  const knex = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => knex.destroy());
  await knex.schema.createTable("cards", (table) => {
    table.increments("id");
    table.integer("workspace_id").notNullable();
    table.string("title").notNullable();
    table.string("public_token");
    table.boolean("sent");
    table.integer("views");
    table.dateTime("issued_at");
  });
  await knex("cards").insert([
    { workspace_id: 1, title: "Rex", public_token: "t1", sent: 1, views: 3 },
    { workspace_id: 1, title: "Bo", public_token: "t2", sent: 0, views: null },
    { workspace_id: 2, title: "Kit", public_token: "t3", sent: 1, views: 1 }
  ]);
  const resource = defineTableResource({
    name: "cards",
    tableName: "cards",
    ownership: "workspace",
    schema: {
      workspaceId: { type: "id", required: true, hidden: true, storage: { column: "workspace_id" } },
      title: { type: "string", required: true, search: true },
      publicToken: { type: "string", nullable: true, hidden: true, storage: { column: "public_token" } },
      sent: { type: "boolean", nullable: true, hidden: true },
      views: { type: "integer", nullable: true, hidden: true },
      issuedAt: { type: "dateTime", nullable: true, hidden: true, storage: { column: "issued_at" } }
    }
  });
  const runtime = await createTestResourceRuntime({ knex });
  const { cards } = await runtime.own("cards.feature", [resource]);
  const system = runtime.declareSystemScope("cards.feature", "send each workspace its cards")("send the cards");
  // The tables each SELECT reads, in order.
  const selects = async (work) => (await countQueries(knex, work)).queries
    .filter((sql) => /^select/iu.test(sql))
    .map((sql) => [...sql.matchAll(/from `(\w+)`/gu)].map(([, table]) => table)[0]);
  return { cards, resource, system, selects, options: { context: WORKSPACE_A } };
}

test("a handle's plain read answers the hidden fields its fields names, in one more statement, and no read without them does", async (t) => {
  const { cards, system, selects, options } = await createCardFixture(t);
  let card;
  const plainRead = await selects(async () => {
    card = await cards.get("1", {}, options);
  });
  assert.deepEqual(card, { id: "1", title: "Rex" });
  assert.deepEqual(await selects(async () => {
    card = await cards.get("1", { fields: ["title", "publicToken", "workspaceId"] }, options);
  }), [...plainRead, "cards"]);
  assert.deepEqual(card, { id: "1", title: "Rex", publicToken: "t1", workspaceId: "1" });
  assert.equal(await cards.get("3", { fields: ["publicToken"] }, { ...options, missing: "skip" }), null);

  const { records } = await cards.query({ fields: ["title", "sent", "views"], page: { size: 10 } }, options);
  assert.deepEqual(records, [{ id: "1", title: "Rex", sent: true, views: 3 }, { id: "2", title: "Bo", sent: false, views: null }]);
  assert.deepEqual(await cards.queryAll({ filters: { title: "Bo" }, fields: ["publicToken"] }, options), [{ id: "2", publicToken: "t2" }]);

  // A system context reads every workspace's rows, and learns each one's owner.
  const owners = await cards.queryAll({ fields: ["workspaceId"] }, { context: system });
  assert.deepEqual(owners, [{ id: "1", workspaceId: "1" }, { id: "2", workspaceId: "1" }, { id: "3", workspaceId: "2" }]);

  // The locks read them after the locking read, in the same transaction.
  await cards.withTransaction(options, async (tx) => {
    assert.deepEqual(await cards.lock("1", { ...tx, fields: ["publicToken"] }), { id: "1", publicToken: "t1" });
    assert.deepEqual(await cards.lockMany(["1", "2"], { ...tx, fields: ["sent"] }), [{ id: "1", sent: true }, { id: "2", sent: false }]);
    assert.deepEqual(await cards.lockWhere({ title: "Rex" }, { ...tx, fields: ["views"] }), [{ id: "1", views: 3 }]);
    assert.deepEqual(await cards.claim({ filters: { title: "Bo" } }, { ...tx, fields: ["title", "publicToken"] }),
      [{ id: "2", title: "Bo", publicToken: "t2" }]);
  });
});

test("a JSON:API read never answers a hidden field, and a hidden field a read cannot decode is refused before it runs", async (t) => {
  const { cards, selects, options } = await createCardFixture(t);
  const document = await cards.query({ fields: ["title", "publicToken"], page: { size: 10 } }, { ...options, format: "jsonapi" });
  assert.deepEqual(document.data.map(({ attributes }) => attributes), [{ title: "Rex" }, { title: "Bo" }]);
  const one = await cards.get("1", { fields: ["title", "publicToken"] }, { ...options, format: "jsonapi" });
  assert.deepEqual(one.data.attributes, { title: "Rex" });

  assert.deepEqual(await selects(() => assert.rejects(cards.queryAll({ fields: ["issuedAt"] }, options),
    /cards: fields names the hidden field "issuedAt", but a read answers a hidden field only when it is a stored id/u)), []);
});

test("withoutHiddenFields refuses another feature's read naming a hidden field, unless it runs in a system context", async (t) => {
  const { cards, resource, system, options } = await createCardFixture(t);
  const exposed = withoutHiddenFields(cards, resource);
  await assert.rejects(exposed.get("1", { fields: ["title", "publicToken"] }, options),
    /cards\.get\(\) fields names the hidden field "publicToken", which only the table's owner, or a system context, reads/u);
  await assert.rejects(exposed.queryAll({ fields: ["workspaceId", "sent"] }, options), /hidden field "workspaceId", "sent"/u);
  await assert.rejects(exposed.withTransaction(options, (tx) => exposed.lockMany(["1"], { ...tx, fields: ["publicToken"] })),
    /cards\.lockMany\(\) fields names the hidden field "publicToken"/u);
  assert.deepEqual(await exposed.get("1", { fields: ["title"] }, options), { id: "1", title: "Rex" });
  assert.deepEqual(await exposed.queryAll({ filters: { title: "Kit" }, fields: ["workspaceId"] }, { context: system }),
    [{ id: "3", workspaceId: "2" }]);
  assert.deepEqual(await exposed.queryAll({ filters: { title: "Kit" }, fields: ["publicToken"] }, { context: system.forWorkspace("2") }),
    [{ id: "3", publicToken: "t3" }]);
  // Everything else is the repository's own, and a resource without hidden fields keeps its repository.
  assert.equal(exposed.column("title"), cards.column("title"));
  assert.equal(exposed.name, "cards");
  assert.equal(Object.isFrozen(exposed), true);
  const plain = defineTableResource({ name: "notes", tableName: "notes", ownership: "public", schema: { body: { type: "string" } } });
  assert.equal(withoutHiddenFields(cards, plain), cards);
});

test("withoutHiddenFields refuses another feature's scopedQuery, whose builder carries the hidden columns, and the owner's join source still joins", async (t) => {
  const { cards, resource, system, options } = await createCardFixture(t);
  // The owner's join source, a method its decorateRepository adds with the handle it receives.
  async function cardSource(alias, callOptions) {
    const { query } = await cards.scopedQuery({ alias }, callOptions);
    return { query, column: (field) => cards.column(field, alias) };
  }
  const exposed = withoutHiddenFields(Object.freeze({ ...cards, cardSource }), resource);

  // Another feature's own builder would select the token: refused before it reads anything.
  await assert.rejects(
    (async () => (await exposed.scopedQuery({}, options)).query.select(exposed.column("publicToken")))(),
    /cards\.scopedQuery\(\) answers every column, its hidden fields too, which only the table's owner, or a system context, reads/u
  );
  await assert.rejects(exposed.withTransaction(options, (tx) => exposed.scopedQuery({ alias: "c" }, tx)), /cards\.scopedQuery\(\)/u);

  // A system context, and one it derived, still builds on it.
  const { query: everyWorkspace } = await exposed.scopedQuery({}, { context: system });
  assert.deepEqual((await everyWorkspace.count({ cards: exposed.column("id") }))[0].cards, 3);
  const { query: workspaceTwo } = await exposed.scopedQuery({}, { context: system.forWorkspace("2") });
  assert.deepEqual(await workspaceTwo.select({ title: exposed.column("title") }), [{ title: "Kit" }]);

  // The cross-owner report pattern: the owner's method answers its scoped rows, which the report selects from.
  const source = await exposed.cardSource("c", options);
  const rows = await source.query.select({ title: source.column("title") }).orderBy(source.column("id"));
  assert.deepEqual(rows, [{ title: "Rex" }, { title: "Bo" }]);
});

test("withoutHiddenFields strips the hidden fields from every answer of a read the owner adds, unless it runs in a system context", async (t) => {
  const { cards, resource, system, options } = await createCardFixture(t);
  // The owner's decorateRepository reads: one forwarding the caller's params, the handle's own under another name, one
  // answering a map, one in a sub-repository and one answering at once.
  const owner = Object.freeze({
    ...cards,
    queryAllIncludingArchived: (params, callOptions) => cards.queryAll(params, callOptions),
    everyCard: cards.queryAll,
    async cardsByTitle(callOptions) {
      const records = await cards.queryAll({ fields: ["title", "publicToken"] }, callOptions);
      return new Map(records.map((record) => [record.title, record]));
    },
    archive: Object.freeze({ list: (callOptions) => cards.queryAll({ fields: ["title", "views"] }, callOptions) }),
    tokenLength: (card) => String(card.publicToken).length
  });
  const exposed = withoutHiddenFields(owner, resource);

  // Another feature's calls: no hidden field leaves, whatever the method's name or depth.
  assert.deepEqual(await exposed.queryAllIncludingArchived({ filters: { title: "Rex" }, fields: ["title", "publicToken", "workspaceId"] }, options),
    [{ id: "1", title: "Rex" }]);
  assert.deepEqual(await exposed.everyCard({ filters: { title: "Bo" }, fields: ["publicToken"] }, options), [{ id: "2" }]);
  assert.deepEqual([...(await exposed.cardsByTitle(options)).values()], [{ id: "1", title: "Rex" }, { id: "2", title: "Bo" }]);
  assert.deepEqual(await exposed.archive.list(options), [{ id: "1", title: "Rex" }, { id: "2", title: "Bo" }]);
  // A method that answers at once still does, and withTransaction answers the caller's own work as it is.
  assert.equal(exposed.tokenLength({ publicToken: "abc" }), 3);
  assert.deepEqual(await exposed.withTransaction(options, async () => ({ publicToken: "the caller's own" })), { publicToken: "the caller's own" });

  // The owner, with its own repository, and a system context, or one it derived, still read them when named.
  assert.deepEqual(await owner.queryAllIncludingArchived({ filters: { title: "Rex" }, fields: ["publicToken"] }, options),
    [{ id: "1", publicToken: "t1" }]);
  assert.deepEqual(await exposed.queryAllIncludingArchived({ filters: { title: "Kit" }, fields: ["publicToken", "workspaceId"] }, { context: system }),
    [{ id: "3", publicToken: "t3", workspaceId: "2" }]);
  assert.deepEqual(await exposed.archive.list({ context: system.forWorkspace("2") }), [{ id: "3", title: "Kit", views: 1 }]);
});
