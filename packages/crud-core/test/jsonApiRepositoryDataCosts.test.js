import assert from "node:assert/strict";
import test from "node:test";
import knexLib from "knex";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import {
  createResourceHost,
  createJsonRestResourceScopeOptions
} from "@jskit-ai/resource-runtime/server/resourceHost";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { createCrudJsonApiRepository } from "../src/server/jsonApiModule/repository.js";

// People in teams, parents owned by people, and children of parents, each read
// through a row policy for the context's team, as a real application's are.
const resources = {
  people: defineTableResource({
    name: "people",
    tableName: "people",
    schema: { id: { type: "id", primary: true }, name: { type: "string" }, team: { type: "string" } }
  }),
  parents: defineTableResource({
    name: "parents",
    tableName: "parents",
    schema: {
      id: { type: "id", primary: true },
      title: { type: "string" },
      ownerId: { type: "id", belongsTo: "people", as: "owner" }
    }
  }),
  children: defineTableResource({
    name: "children",
    tableName: "children",
    schema: {
      id: { type: "id", primary: true },
      parentId: { type: "id", belongsTo: "parents", as: "parent" },
      authorId: { type: "id", belongsTo: "people", as: "author" },
      title: { type: "string" }
    }
  })
};

async function createFixture(t) {
  const knex = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => knex.destroy());
  await knex.schema.createTable("people", (table) => { table.increments("id"); table.string("name"); table.string("team"); });
  await knex.schema.createTable("parents", (table) => { table.increments("id"); table.string("title"); table.integer("owner_id"); });
  await knex.schema.createTable("children", (table) => {
    table.increments("id"); table.integer("parent_id"); table.integer("author_id"); table.string("title");
  });
  await knex("people").insert([{ name: "Ada", team: "a" }, { name: "Bea", team: "b" }]);
  await knex("parents").insert([{ title: "Visible", owner_id: 1 }, { title: "Hidden", owner_id: 2 }]);

  const policyRuns = [];
  const team = (context) => context?.team || "__none__";
  const policies = {
    people: ({ query, context, column }) => {
      query.where(column("team"), team(context));
      return true;
    },
    parents: ({ query, context, column }) => {
      query.whereExists(function visibleOwner() {
        this.select(1).from("people as owner").whereRaw("owner.id = ??", [column("ownerId")]).where("owner.team", team(context));
      });
      return true;
    },
    children: ({ query, context, column }) => {
      query.whereExists(function visibleParent() {
        this.select(1).from("parents as parent").join("people as owner", "owner.id", "parent.owner_id")
          .whereRaw("parent.id = ??", [column("parentId")]).where("owner.team", team(context));
      });
      return true;
    }
  };
  const api = await createResourceHost({ knex, logger: silentLogger });
  for (const [name, resource] of Object.entries(resources)) {
    await api.addResource(name, createJsonRestResourceScopeOptions(resource, {
      rowPolicy: (args) => {
        policyRuns.push(`${name}:${args.queryPurpose}`);
        return policies[name](args);
      }
    }));
  }
  const children = createCrudJsonApiRepository({ api, resource: resources.children, resourceScopeName: "children" });

  // Statements and row-policy runs of one operation; BEGIN and COMMIT counted apart.
  async function measure(run) {
    const counts = { statements: 0, transactionStatements: 0, policy: {} };
    const onQuery = ({ sql }) => {
      if (/^(begin|commit|rollback|savepoint|release)/iu.test(sql.trim())) {
        counts.transactionStatements += 1;
      } else {
        counts.statements += 1;
      }
    };
    policyRuns.length = 0;
    knex.on("query", onQuery);
    try {
      counts.result = await run();
    } finally {
      knex.removeListener("query", onQuery);
    }
    for (const run of policyRuns) {
      counts.policy[run] = (counts.policy[run] || 0) + 1;
    }
    return counts;
  }

  return { knex, api, children, measure };
}

const context = Object.freeze({ team: "a" });
const childPayloads = (count) => Array.from({ length: count }, (_, index) => ({ parentId: 1, authorId: 1, title: `Child ${index}` }));

test("createDocuments writes a batch in one transaction and reads no record back", async (t) => {
  const { knex, children, measure } = await createFixture(t);
  const small = await measure(() => children.createDocuments(childPayloads(10), { context }));
  const large = await measure(() => children.createDocuments(childPayloads(100), { context }));

  assert.deepEqual(large.result.slice(0, 2), [
    { data: { type: "children", id: "11" } },
    { data: { type: "children", id: "12" } }
  ]);
  assert.equal(await knex("children").count({ count: "*" }).first().then(({ count }) => Number(count)), 110);
  for (const batch of [small, large]) {
    // One owned transaction for the whole batch, whatever its size.
    assert.equal(batch.transactionStatements, 2);
    // No read-back: no get preflight and no visibility check of the new rows' links.
    assert.equal(batch.policy["children:relationship-identifiers"], undefined);
    assert.equal(batch.policy["parents:relationship-identifiers"], undefined);
    assert.equal(batch.policy["people:relationship-identifiers"], undefined);
  }
});

test("returning minimal or none skips the read-back that returning full pays per created row", async (t) => {
  const { children, measure } = await createFixture(t);
  const perRow = {};
  for (const returning of ["full", "minimal", "none"]) {
    const counts = [];
    for (const size of [10, 50]) {
      const measured = await measure(() => children.withTransaction(async (trx) => {
        for (const payload of childPayloads(size)) {
          await children.createDocument(payload, { trx, context, returning });
        }
      }));
      counts.push(measured);
    }
    // Per-row cost: the difference between 50 and 10 rows, over 40 rows.
    perRow[returning] = (counts[1].statements - counts[0].statements) / 40;
    const linkageRuns = Object.entries(counts[1].policy)
      .filter(([run]) => run.endsWith(":relationship-identifiers"))
      .reduce((sum, [, runs]) => sum + runs, 0);
    assert.equal(linkageRuns, returning === "full" ? 100 : 0, `${returning} linkage checks`);
  }
  // The read-back is a get: its preflight, its read and one visibility check per linked type.
  assert.ok(perRow.full - perRow.minimal >= 4, JSON.stringify(perRow));
  assert.equal(perRow.minimal, perRow.none, JSON.stringify(perRow));
});

test("createDocuments results follow the payloads, and a failing payload leaves none created", async (t) => {
  const { knex, children } = await createFixture(t);
  const full = await children.createDocuments(childPayloads(2), { context, returning: "full" });
  assert.deepEqual(full.map((document) => document.data.attributes.title), ["Child 0", "Child 1"]);
  assert.deepEqual(await children.createDocuments(childPayloads(2), { context, returning: "none" }), [undefined, undefined]);

  // The second payload links a parent the reader cannot see, so the batch rolls back.
  await assert.rejects(
    () => children.createDocuments([{ parentId: 1, authorId: 1, title: "Kept?" }, { parentId: 2, authorId: 1, title: "Hidden parent" }], { context }),
    /non-existent parents with id 2/
  );
  assert.equal(await knex("children").where({ title: "Kept?" }).first(), undefined);
  await assert.rejects(() => children.createDocuments({ title: "Not a list" }), /requires an array of payloads/);
  await assert.rejects(() => children.createDocument({ title: "x" }, { returning: "ids" }), /returning must be "full", "minimal" or "none"/);
});

test("patchDocumentById with returning minimal answers the identifier, and null for a record out of scope", async (t) => {
  const { children } = await createFixture(t);
  const [{ data: created }] = await children.createDocuments(childPayloads(1), { context });
  assert.deepEqual(
    await children.patchDocumentById(created.id, { title: "Renamed" }, { context, returning: "minimal" }),
    { data: { type: "children", id: created.id } }
  );
  assert.deepEqual(
    await children.patchDocumentById(created.id, {}, { context, returning: "minimal" }),
    { data: { type: "children", id: created.id } }
  );
  assert.equal(await children.patchDocumentById(created.id, { title: "Other team" }, { context: { team: "b" }, returning: "none" }), null);
  assert.equal((await children.getDocumentById(created.id, {}, { context })).data.attributes.title, "Renamed");
});
