import assert from "node:assert/strict";
import test from "node:test";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { countQueries } from "@jskit-ai/database-runtime/server/testDatabases";
import { withoutHiddenFields } from "../src/server/index.js";
import { createPackageTestKnex, createTestResourceRuntime } from "../src/test/index.js";

// SQLite in memory, or a PostgreSQL schema of its own on a DB_CLIENT=pg run (see createPackageTestKnex).
const testKnex = (t) => createPackageTestKnex(t, { environment: process.env });

const WORKSPACE_A = Object.freeze({ workspace: { id: "1" } });

// Cards with a hidden owner, a hidden bearer token, a hidden flag, a hidden count and a hidden time: two in workspace
// 1 and one in workspace 2.
async function createCardFixture(t) {
  const knex = await testKnex(t);
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
    .map((sql) => [...sql.matchAll(/from [`"](\w+)[`"]/gu)].map(([, table]) => table)[0]);
  return { knex, cards, resource, system, selects, options: { context: WORKSPACE_A } };
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

test("withoutHiddenFields refuses another feature's scopedQuery, and any builder a method answers but a joinSource()'s, which carries no hidden column but the ownership fields", async (t) => {
  const { knex, cards, resource, system, options } = await createCardFixture(t);
  // Methods an owner's decorateRepository adds with the handle it receives, answering its scoped rows as scopedQuery()
  // gives them, every column with them: wrapped, and at once.
  async function cardSource(alias, callOptions) {
    const { query } = await cards.scopedQuery({ alias }, callOptions);
    return { query, column: (field) => cards.column(field, alias) };
  }
  const everyColumn = () => knex("cards");
  const exposed = withoutHiddenFields(Object.freeze({ ...cards, cardSource, everyColumn }), resource);

  // Another feature's own builder would select the token: refused before it reads anything.
  await assert.rejects(
    (async () => (await exposed.scopedQuery({}, options)).query.select(exposed.column("publicToken")))(),
    /cards\.scopedQuery\(\) answers every column, its hidden fields too, which only the table's owner, or a system context, reads: read the rows through the repository's reads, or join its joinSource\(\{ alias \}, options\)/u
  );
  await assert.rejects(exposed.withTransaction(options, (tx) => exposed.scopedQuery({ alias: "c" }, tx)), /cards\.scopedQuery\(\)/u);
  await assert.rejects(exposed.cardSource("c", options),
    /cards\.cardSource\(\) answers a query builder, which can select every column, the hidden fields too, which only the table's owner, or a system context, reads: answer the table's joinSource\(\{ alias \}, options\)/u);
  assert.throws(() => exposed.everyColumn(), /cards\.everyColumn\(\) answers a query builder/u);

  // A system context, and one it derived, still builds on them.
  const { query: everyWorkspace } = await exposed.scopedQuery({}, { context: system });
  assert.deepEqual(Number((await everyWorkspace.count({ cards: exposed.column("id") }))[0].cards), 3);
  const { query: workspaceTwo } = await exposed.scopedQuery({}, { context: system.forWorkspace("2") });
  assert.deepEqual(await workspaceTwo.select({ title: exposed.column("title") }), [{ title: "Kit" }]);
  const everyCard = await exposed.cardSource("c", { context: system });
  assert.deepEqual(await everyCard.query.select({ token: everyCard.column("publicToken") }).orderBy(everyCard.column("id")),
    [{ token: "t1" }, { token: "t2" }, { token: "t3" }]);

  // The cross-owner report pattern: the table's joinSource() answers the caller's scoped rows, which the report
  // selects from, with the columns a read answers and the ownership fields, and no other.
  const source = await exposed.joinSource({ alias: "c" }, options);
  const rows = await source.query.select({ title: source.column("title") }).orderBy(source.column("id"));
  assert.deepEqual(rows, [{ title: "Rex" }, { title: "Bo" }]);
  const { query: rex } = await exposed.joinSource({ alias: "c", filters: { title: "Rex" } }, options);
  assert.deepEqual((await rex).map((row) => Object.keys(row)), [["id", "workspace_id", "title"]]);
  assert.throws(() => source.column("publicToken"),
    /cards\.joinSource\(\) carries no hidden field but its ownership fields, so it has no column for "publicToken"/u);
  // The hidden workspaceId is a join key the source carries: a system report counts each workspace's cards on it.
  const perWorkspace = await exposed.joinSource({ alias: "c" }, { context: system });
  const workspaceId = perWorkspace.column("workspaceId");
  const counts = await perWorkspace.query.select({ workspaceId }).count({ cards: perWorkspace.column("id") })
    .groupBy(workspaceId).orderBy(workspaceId);
  assert.deepEqual(counts.map((row) => [Number(row.workspaceId), Number(row.cards)]), [[1, 2], [2, 1]]);
  const again = await exposed.joinSource({ alias: "c" }, options);
  await assert.rejects(async () => again.query.select(cards.column("publicToken", "c")), /public_token/u);
  await assert.rejects(exposed.joinSource({}, options), /cards\.joinSource\(\) needs the alias the report joins the cards under/u);
});

test("withoutHiddenFields answers raw(), column(), joinSource() and an owner's Knex values as they are, so another feature builds on them in a scoped query and a subquery", async (t) => {
  const { cards, resource, options } = await createCardFixture(t);
  // An owner's method answering a Knex value at once: an expression over its own column.
  const lowerTitle = (alias) => cards.raw("LOWER(??)", [cards.column("title", alias)]);
  const exposed = withoutHiddenFields(Object.freeze({ ...cards, lowerTitle }), resource);

  assert.equal(exposed.column("title", "c"), cards.column("title", "c"));
  const shout = exposed.raw("UPPER(??)", [exposed.column("title", "c")]);
  assert.equal(shout.then, undefined);
  assert.equal(typeof exposed.lowerTitle("i").toSQL, "function");

  // In the owner's scoped rows, as a select.
  const source = await exposed.joinSource({ alias: "c" }, options);
  assert.deepEqual(await source.query.select({ shout }).orderBy(source.column("id")), [{ shout: "REX" }, { shout: "BO" }]);

  // In a subquery: the cards of workspace 1 whose lower-cased title is "bo".
  const outer = await exposed.joinSource({ alias: "c" }, options);
  const inner = await exposed.joinSource({ alias: "i" }, options);
  const matching = inner.query.select(inner.column("id")).where(exposed.lowerTitle("i"), exposed.raw("?", ["bo"]));
  assert.deepEqual(await outer.query.whereIn(outer.column("id"), matching).select({ title: outer.column("title") }), [{ title: "Bo" }]);
});

test("withoutHiddenFields refuses a hidden field named through any method, and strips the hidden fields from every answer of a read the owner adds, unless it runs in a system context", async (t) => {
  const { cards, resource, system, options } = await createCardFixture(t);
  // The owner's decorateRepository reads: one forwarding the caller's params, the handle's own under another name, one
  // taking its options first, one answering a map, one in a sub-repository and one answering at once.
  const owner = Object.freeze({
    ...cards,
    queryAllIncludingArchived: (params, callOptions) => cards.queryAll(params, callOptions),
    everyCard: cards.queryAll,
    cardsTitled: (callOptions, { title }) => cards.queryAll({ filters: { title }, fields: ["title", "publicToken"] }, callOptions),
    async cardsByTitle(callOptions) {
      const records = await cards.queryAll({ fields: ["title", "publicToken"] }, callOptions);
      return new Map(records.map((record) => [record.title, record]));
    },
    archive: Object.freeze({ list: (callOptions) => cards.queryAll({ fields: ["title", "views"] }, callOptions) }),
    tokenLength: (card) => String(card.publicToken).length
  });
  const exposed = withoutHiddenFields(owner, resource);

  // Another feature's calls: a hidden field its fields names is refused before the method runs, whatever the method's
  // name, as a list or a sparse fieldset, so a method forwarding the caller's fields never answers it as undefined.
  await assert.rejects(exposed.queryAllIncludingArchived({ filters: { title: "Rex" }, fields: ["title", "publicToken", "workspaceId"] }, options),
    /cards\.queryAllIncludingArchived\(\) fields names the hidden field "publicToken", "workspaceId", which only the table's owner, or a system context, reads/u);
  await assert.rejects(exposed.everyCard({ filters: { title: "Bo" }, fields: { cards: "title, sent" } }, options),
    /cards\.everyCard\(\) fields names the hidden field "sent"/u);
  assert.deepEqual(await exposed.queryAllIncludingArchived({ filters: { title: "Rex" }, fields: ["title"] }, options), [{ id: "1", title: "Rex" }]);
  // No hidden field the owner's own reads name leaves, whatever the method's name or depth.
  assert.deepEqual(await exposed.cardsTitled(options, { title: "Rex" }), [{ id: "1", title: "Rex" }]);
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
  // The system context counts in whichever record carries it, not only the last.
  assert.deepEqual(await exposed.cardsTitled({ context: system.forWorkspace("2") }, { title: "Kit" }), [{ id: "3", title: "Kit", publicToken: "t3" }]);
});

test("withoutHiddenFields refuses a field one owned table hides and another shows, since it strips hidden fields by name", () => {
  const cards = defineTableResource({
    name: "cards",
    tableName: "cards",
    ownership: "public",
    schema: { title: { type: "string" }, publicToken: { type: "string", hidden: true } }
  });
  const links = (hidden) => defineTableResource({
    name: "links",
    tableName: "links",
    ownership: "public",
    schema: { publicToken: { type: "string", ...(hidden ? { hidden } : {}) } }
  });
  const repository = Object.freeze({ get: async () => ({ id: "1", publicToken: "t1" }) });
  assert.throws(() => withoutHiddenFields(repository, [cards, links(false)]),
    /links\.publicToken is a visible field, but cards, which the same feature owns, hides a field of that name; its repository strips hidden fields by name from every answer/u);
  assert.throws(() => withoutHiddenFields(repository, [links(false), cards]), /links\.publicToken is a visible field, but cards/u);
  // Hidden in both, it is one hidden field.
  assert.equal(typeof withoutHiddenFields(repository, [cards, links(true)]).get, "function");
});
