import assert from "node:assert/strict";
import test from "node:test";
import { createPackageTestKnex, startTestFeatures } from "@jskit-ai/resource-runtime/test";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { defineCrudContract } from "@jskit-ai/resource-crud-core/shared/crudContract";
import { defineCrudFeature } from "../src/server/defineCrudFeature.js";
import { CrudContractsProvider } from "../src/server/crudContracts.js";

// SQLite in memory, or a PostgreSQL schema of its own on a DB_CLIENT=pg run (see createPackageTestKnex).
const testKnex = (t) => createPackageTestKnex(t, { environment: process.env });

test("a CRUD feature's repository reads a hidden field of its table only in a system context; its owner's methods read it", async (t) => {
  const knex = await testKnex(t);
  await knex.schema.createTable("tickets", (table) => {
    table.increments("id");
    table.string("title").notNullable();
    table.string("claim_code");
  });
  await knex("tickets").insert({ title: "Lost umbrella", claim_code: "c1" });
  const crud = defineCrudContract(defineTableResource({
    name: "tickets",
    tableName: "tickets",
    ownership: "public",
    schema: {
      title: { type: "string", required: true },
      claimCode: { type: "string", nullable: true, hidden: true, storage: { column: "claim_code" } }
    }
  }), { namespace: "tickets", operations: ["list", "view"], fields: { title: { output: "required" } } });
  let systemContext;
  const feature = defineCrudFeature({
    crud,
    surface: "home",
    routes: false,
    systemScope: "check the claim code of any ticket",
    decorateRepository({ repository, systemContext: given }) {
      systemContext = given;
      return Object.freeze({
        ...repository,
        // The owner's own command reads the hidden field with its handle.
        async matchesClaimCode(id, code, options) {
          return (await repository.get(id, { fields: ["claimCode"] }, options)).claimCode === code;
        }
      });
    }
  });
  const { capabilities: { tickets }, stop } = await startTestFeatures({
    knex,
    features: [CrudContractsProvider, feature],
    requires: { tickets: "crud.tickets" },
    inputs: { "runtime.http": { router: { register() {} } } }
  });
  t.after(stop);

  assert.equal(await tickets.repository.matchesClaimCode("1", "c1", {}), true);
  await assert.rejects(tickets.repository.get("1", { fields: ["title", "claimCode"] }, {}),
    /tickets\.get\(\) fields names the hidden field "claimCode", which only the table's owner, or a system context, reads/u);
  assert.deepEqual(await tickets.repository.get("1", { fields: ["title"] }, {}), { id: "1", title: "Lost umbrella" });
  assert.deepEqual(await tickets.repository.queryAll({ fields: ["title", "claimCode"] }, { context: systemContext("audit the claim codes") }),
    [{ id: "1", title: "Lost umbrella", claimCode: "c1" }]);
  // The CRUD service is the HTTP edge: its JSON:API documents never carry a hidden field.
  assert.deepEqual((await tickets.service.view("1", { fields: { tickets: "title,claimCode" } }, {})).value.data.attributes,
    { title: "Lost umbrella" });
});
