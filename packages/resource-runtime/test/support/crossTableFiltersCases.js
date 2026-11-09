import assert from "node:assert/strict";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { createTestResourceRuntime } from "../../src/test/index.js";

// A search filter that reads another owner's table, on every database the runtime supports: json-rest-api joins that
// table as the table's own read in the caller's scope, so its ownership, its owner's row policy and the policies
// contributed to it decide which of its rows a filter can match; own() refuses a filter into a system table or onto a
// hidden field. Each database's test file runs these cases on its own connection.

const WORKSPACE_A = Object.freeze({ workspace: Object.freeze({ id: "1" }) });
// A request hides what only background work may see.
const inRequest = (caller) => caller.kind === "user" || caller.kind === "anonymous";

const supplierResource = defineTableResource({
  name: "suppliers",
  tableName: "suppliers",
  ownership: "workspace",
  searchSchema: { itemName: { type: "string", actualField: "items.name" } },
  relationships: { items: { type: "hasMany", target: "items", foreignKey: "supplierId" } },
  schema: {
    workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
    name: { type: "string", required: true, indexed: true },
    archived: { type: "boolean", defaultTo: false },
    blocked: { type: "boolean", defaultTo: false },
    token: { type: "string", nullable: true, hidden: true, indexed: true }
  }
});

const itemResource = (searchSchema = { supplierName: { type: "string", actualField: "suppliers.name" } }, schema = {}) => defineTableResource({
  name: "items",
  tableName: "items",
  ownership: "workspace",
  searchSchema,
  schema: {
    workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
    name: { type: "string", required: true, indexed: true },
    supplierId: { type: "id", nullable: true, belongsTo: "suppliers", as: "supplier", storage: { column: "supplier_id" } },
    ...schema
  }
});

const vaultResource = defineTableResource({
  name: "vaults",
  tableName: "vaults",
  ownership: "system",
  schema: { code: { type: "string", required: true, indexed: true } }
});

/**
 * Suppliers in workspace 1: Acme, Bolt (archived, which only background work sees) and Crate (blocked by the items
 * feature's contributed policy, for everyone); and an Acme in workspace 2. Workspace 1's items: Hammer twice and
 * Recalled (which only background work sees) from Acme, Nails from Bolt, Box from Crate and Saw from workspace 2's Acme.
 */
async function suppliersAndItems(knex) {
  await knex.schema.createTable("suppliers", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.string("name").notNullable().index();
    table.boolean("archived").notNullable().defaultTo(false);
    table.boolean("blocked").notNullable().defaultTo(false);
    table.string("token").nullable();
  });
  await knex.schema.createTable("items", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.string("name").notNullable().index();
    table.integer("supplier_id").nullable().index();
  });
  await knex("suppliers").insert([
    { workspace_id: 1, name: "Acme", archived: false, blocked: false },
    { workspace_id: 1, name: "Bolt", archived: true, blocked: false },
    { workspace_id: 2, name: "Acme", archived: false, blocked: false },
    { workspace_id: 1, name: "Crate", archived: false, blocked: true }
  ]);
  await knex("items").insert([
    { workspace_id: 1, name: "Hammer", supplier_id: 1 },
    { workspace_id: 1, name: "Nails", supplier_id: 2 },
    { workspace_id: 1, name: "Saw", supplier_id: 3 },
    { workspace_id: 1, name: "Box", supplier_id: 4 },
    { workspace_id: 1, name: "Hammer", supplier_id: 1 },
    { workspace_id: 1, name: "Recalled", supplier_id: 1 },
    { workspace_id: 2, name: "Drill", supplier_id: 3 }
  ]);
  const runtime = await createTestResourceRuntime({ knex });
  const { suppliers } = await runtime.own("suppliers.feature", [{
    resource: supplierResource,
    acceptsContributions: true,
    rowPolicy: ({ query, column, caller }) => {
      if (inRequest(caller)) query.where(column("archived"), false);
      return true;
    }
  }]);
  const owned = await runtime.own("items.feature", [{
    resource: itemResource(),
    rowPolicy: ({ query, column, caller }) => {
      if (inRequest(caller)) query.whereNot(column("name"), "Recalled");
      return true;
    }
  }]);
  owned.contributeRowPolicy("suppliers", ({ query, column }) => {
    query.where(column("blocked"), false);
    return true;
  });
  const job = runtime.declareSystemScope("items.feature", "restock every workspace")("restock").forWorkspace("1");
  return { suppliers, items: owned.items, job: { context: job } };
}

const names = (records) => records.map(({ name }) => name);

/**
 * @param {(t: import("node:test").TestContext, suffix: string) => Promise<import("knex").Knex>} connect
 *   The test's own empty database; `suffix` names it where the database needs a name.
 */
function crossTableFiltersCases(connect) {
  return [
    ["a filter on another owner's table matches only the rows the caller's scope reads there: its ownership, its owner's row policy and the policies contributed to it", async (t) => {
      const knex = await connect(t, "da_xt_scope");
      const { suppliers, items, job } = await suppliersAndItems(knex);
      const request = { context: WORKSPACE_A };
      const itemsOf = async (supplierName, options) => names(await items.queryAll({ filters: { supplierName } }, options));

      // Workspace 2's Acme is not the caller's, so Saw, which names it, matches no Acme of the caller's.
      assert.deepEqual(await itemsOf("Acme", request), ["Hammer", "Hammer"]);
      assert.deepEqual(await itemsOf("Acme", job), ["Hammer", "Hammer", "Recalled"]);
      // The suppliers' owner shows an archived supplier to background work only.
      assert.deepEqual(await itemsOf("Bolt", request), []);
      assert.deepEqual(await itemsOf("Bolt", job), ["Nails"]);
      // The contributed policy hides a blocked supplier from everyone.
      assert.deepEqual(await itemsOf("Crate", request), []);
      assert.deepEqual(await itemsOf("Crate", job), []);
      // An aggregate filters the same way, counting each item once.
      assert.deepEqual(await items.aggregate({ measures: { items: { count: "*" } }, filters: { supplierName: "Acme" } }, request), [{ items: 2 }]);
      const page = await items.query({ filters: { supplierName: "Acme" }, page: { size: 1 } }, request);
      assert.deepEqual([names(page.records), page.page.hasMore], [["Hammer"], true]);

      // The other way, a supplier filtered by its items' names: each supplier once, through the items' own scope.
      assert.deepEqual(names(await suppliers.queryAll({ filters: { itemName: "Hammer" } }, request)), ["Acme"]);
      assert.deepEqual(names(await suppliers.queryAll({ filters: { itemName: "Recalled" } }, request)), []);
      assert.deepEqual(names(await suppliers.queryAll({ filters: { itemName: "Recalled" } }, job)), ["Acme"]);
      assert.deepEqual(names(await suppliers.queryAll({ filters: { itemName: "Drill" } }, request)), []);
    }],

    ["own() refuses a filter that reads a system table from a table that is not one, or a field its owner hides, saying what to do instead", async (t) => {
      const knex = await connect(t, "da_xt_refuse");
      const owning = async (...features) => {
        const runtime = await createTestResourceRuntime({ knex });
        for (const [featureId, owns] of features) {
          await runtime.own(featureId, owns);
        }
      };
      const vaultCode = itemResource({ vaultCode: { type: "string", actualField: "vaults.code" } }, {
        vaultId: { type: "id", nullable: true, belongsTo: "vaults", as: "vault", storage: { column: "vault_id" } }
      });
      await assert.rejects(owning(["vaults.feature", [vaultResource]], ["suppliers.feature", [supplierResource]], ["items.feature", [vaultCode]]), {
        name: "TypeError",
        message: 'Table resource "items" filters "vaultCode" on vaults.code, which reads "vaults", a system table: only its ' +
          "owner's system context reads it, and the filter would read it in the caller's scope, a request's too. Make " +
          '"vaults" a table the caller\'s scope guards, or filter on a field of "items", or have the owner of "vaults" ' +
          "answer the ids it matches (an owner API) and filter by them."
      });
      // The filtering table owned first: the check waits for the table it reads.
      await assert.rejects(owning(["items.feature", [vaultCode]], ["suppliers.feature", [supplierResource]], ["vaults.feature", [vaultResource]]),
        /filters "vaultCode" on vaults\.code, which reads "vaults", a system table/u);
      const supplierToken = itemResource({ supplierToken: { type: "string", actualField: "suppliers.token" } });
      await assert.rejects(owning(["vaults.feature", [vaultResource]], ["suppliers.feature", [supplierResource]], ["items.feature", [supplierToken]]),
        /Table resource "items" filters "supplierToken" on suppliers\.token, a field "suppliers" hides: a filter on it would tell a caller who may not read it which rows hold a value\. Filter on a field "suppliers" shows, or filter on a field of "items"/u);
      // A system table may filter on another: its reads already need a system context.
      const ledgerResource = defineTableResource({
        name: "ledgers",
        tableName: "ledgers",
        ownership: "system",
        searchSchema: { vaultCode: { type: "string", actualField: "vaults.code" } },
        schema: { vaultId: { type: "id", nullable: true, belongsTo: "vaults", as: "vault", storage: { column: "vault_id" } } }
      });
      await owning(["vaults.feature", [vaultResource, ledgerResource]]);
    }]
  ];
}

export { crossTableFiltersCases };
