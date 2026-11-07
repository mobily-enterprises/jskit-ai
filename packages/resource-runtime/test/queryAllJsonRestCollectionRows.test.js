import assert from "node:assert/strict";
import test from "node:test";
import knexLib from "knex";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import {
  createResourceHost,
  createJsonRestResourceScopeOptions,
  extractJsonRestCollectionRows,
  queryAllJsonRestCollectionRows
} from "../src/server/resourceHost.js";

// 250 contacts: 200 in team "a" and 50 in team "b", interleaved, named so that
// name order (the resources' default sort) is the reverse of id order.
async function createContactsFixture(t) {
  const knex = knexLib({
    client: "better-sqlite3",
    connection: { filename: ":memory:" },
    useNullAsDefault: true
  });
  t.after(() => knex.destroy());
  await knex.schema.createTable("contacts", (table) => {
    table.increments("id");
    table.string("team").notNullable();
    table.string("name").notNullable();
  });
  const rows = Array.from({ length: 250 }, (_, index) => ({
    team: index % 5 === 4 ? "b" : "a",
    name: `Contact ${String(249 - index).padStart(3, "0")}`
  }));
  for (let start = 0; start < rows.length; start += 100) {
    await knex("contacts").insert(rows.slice(start, start + 100));
  }

  const api = await createResourceHost({ knex, logger: silentLogger });
  const contacts = (name, extra = {}) => defineTableResource({
    name,
    tableName: "contacts",
    defaultSort: ["name"],
    schema: {
      id: { type: "id", primary: true },
      team: { type: "string", search: true },
      name: { type: "string" }
    },
    ...extra
  });
  await api.addResource("contacts", createJsonRestResourceScopeOptions(contacts("contacts")));
  await api.addResource("smallPageContacts", createJsonRestResourceScopeOptions(contacts("smallPageContacts", { queryMaxLimit: 30 })));
  await api.addResource("largePageContacts", createJsonRestResourceScopeOptions(contacts("largePageContacts", { queryMaxLimit: 2000 })));
  return { api, knex };
}

// The real resource, recording the page and page size limit each query asks for.
function recordPages(resource) {
  const pages = [];
  return {
    pages,
    resource: {
      vars: resource.vars,
      query(params, context) {
        pages.push({ ...params.queryParams.page, pageSizeLimit: params.pageSizeLimit });
        return resource.query(params, context);
      }
    }
  };
}

// json-rest-api writes the page and sort it used into the params it receives, so each query gets its own.
function teamA() {
  return { queryParams: { filters: { team: "a" } }, format: "plain" };
}

test("a query without a page returns 20 rows, and queryAllJsonRestCollectionRows returns every match once in id order", async (t) => {
  const { api } = await createContactsFixture(t);
  const firstPage = extractJsonRestCollectionRows(await api.resources.contacts.query(teamA()));
  assert.equal(firstPage.length, 20);

  const { pages, resource } = recordPages(api.resources.contacts);
  const rows = await queryAllJsonRestCollectionRows(resource, teamA(), null);

  const ids = rows.map((row) => Number(row.id));
  assert.equal(rows.length, 200);
  assert.equal(new Set(ids).size, 200);
  assert.deepEqual(ids, [...ids].sort((left, right) => left - right));
  assert.ok(rows.every((row) => row.team === "a"));
  assert.equal(pages[0].after, undefined);
  assert.ok(pages.slice(1).every(({ after }) => typeof after === "string"));
});

test("queryAllJsonRestCollectionRows asks for 1,000-row pages, or the resource's larger maximum", async (t) => {
  const { api } = await createContactsFixture(t);
  for (const [name, size] of [["contacts", 1000], ["smallPageContacts", 1000], ["largePageContacts", 2000]]) {
    const { pages, resource } = recordPages(api.resources[name]);

    const rows = await queryAllJsonRestCollectionRows(resource, teamA(), null);

    assert.equal(rows.length, 200, name);
    assert.equal(new Set(rows.map((row) => row.id)).size, 200, name);
    assert.ok(pages.every((page) => page.size === size && page.pageSizeLimit === size), name);
  }
});

test("queryAllJsonRestCollectionRows returns every one of 1,100 matches across pages", async (t) => {
  const { api, knex } = await createContactsFixture(t);
  const extra = Array.from({ length: 900 }, (_, index) => ({ team: "a", name: `Extra ${String(index).padStart(3, "0")}` }));
  for (let start = 0; start < extra.length; start += 100) {
    await knex("contacts").insert(extra.slice(start, start + 100));
  }
  const { pages, resource } = recordPages(api.resources.contacts);

  const rows = await queryAllJsonRestCollectionRows(resource, teamA(), null);

  const ids = rows.map((row) => Number(row.id));
  assert.equal(rows.length, 1100);
  assert.equal(new Set(ids).size, 1100);
  assert.deepEqual(ids, [...ids].sort((left, right) => left - right));
  // More rows than one page of any size it asks for, so it follows the cursor.
  assert.ok(pages.length >= 2);
  assert.ok(pages.slice(1).every(({ after }) => typeof after === "string"));
});

test("queryAllJsonRestCollectionRows reads every page in the caller's transaction with a copy of its context", async (t) => {
  const { api } = await createContactsFixture(t);
  // json-rest-api writes its working state into the context it receives, so a frozen one must be copied.
  const context = Object.freeze({ scopeValues: Object.freeze({}) });

  await api.transaction(async (trx) => {
    await trx("contacts").insert({ team: "a", name: "Uncommitted" });
    const rows = await queryAllJsonRestCollectionRows(
      api.resources.contacts,
      { ...teamA(), transaction: trx },
      context
    );
    assert.equal(rows.length, 201);
    assert.equal(rows.at(-1).name, "Uncommitted");
  });
});

test("queryAllJsonRestCollectionRows refuses a page or sort, which it sets itself", async (t) => {
  const { api } = await createContactsFixture(t);
  for (const queryParams of [{ filters: { team: "a" }, page: { size: 5 } }, { sort: ["name"] }]) {
    await assert.rejects(
      () => queryAllJsonRestCollectionRows(api.resources.contacts, { queryParams, format: "plain" }, null),
      /pages in id order itself, so queryParams cannot name a page or sort/
    );
  }
});

// json-rest-api 2.4.0 honours pageSizeLimit; an earlier one pages at queryMaxLimit (100).
test("queryAllJsonRestCollectionRows reads 480 and 960 matches in one 1,000-row page at equal cost", async (t) => {
  const { api, knex } = await createContactsFixture(t);
  async function addTeamA(count, prefix) {
    const rows = Array.from({ length: count }, (_, index) => ({ team: "a", name: `${prefix} ${String(index).padStart(3, "0")}` }));
    for (let start = 0; start < rows.length; start += 100) {
      await knex("contacts").insert(rows.slice(start, start + 100));
    }
  }
  async function readTeamA() {
    let statements = 0;
    const count = () => {
      statements++;
    };
    const { pages, resource } = recordPages(api.resources.contacts);
    knex.on("query", count);
    try {
      const rows = await queryAllJsonRestCollectionRows(resource, teamA(), null);
      return { rows: rows.length, pages: pages.length, statements };
    } finally {
      knex.removeListener("query", count);
    }
  }

  await addTeamA(280, "Small");
  const small = await readTeamA();
  await addTeamA(480, "Large");
  const large = await readTeamA();

  assert.deepEqual(small, { rows: 480, pages: 1, statements: large.statements });
  assert.deepEqual(large, { rows: 960, pages: 1, statements: small.statements });
  assert.ok(large.statements <= 2, `${large.statements} statements for 960 rows`);
});
