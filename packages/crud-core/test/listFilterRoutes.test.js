import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { createPackageTestKnex, startTestFeatures } from "@jskit-ai/resource-runtime/test";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { defineCrudContract } from "@jskit-ai/resource-crud-core/shared/crudContract";
import { createRouter } from "../../kernel/server/http/lib/router.js";
import { registerRoutes } from "../../kernel/server/http/lib/routeRegistration.js";
import { registerApiErrorHandler } from "../../kernel/server/http/errorHandling.js";
import { CrudContractsProvider } from "../src/server/crudContracts.js";
import { defineCrudFeature } from "../src/server/defineCrudFeature.js";
import { createCrudListFilterContract } from "../src/server/listFilters.js";

const orders = defineTableResource({
  name: "orders",
  tableName: "orders",
  ownership: "public",
  schema: {
    reference: { type: "string", required: true },
    arrivedAt: { type: "dateTime", storage: { column: "arrived_at" } },
    total: { type: "number" },
    customerId: { type: "id", nullable: true, storage: { column: "customer_id" } }
  }
});

// Each arrives at noon UTC, well inside its day in any time zone.
const ORDERS = Object.freeze([
  { reference: "A", arrivedAt: "2026-02-27T12:00:00.000Z", total: 5, customerId: "1" },
  { reference: "B", arrivedAt: "2026-03-02T12:00:00.000Z", total: 10, customerId: "2" },
  { reference: "C", arrivedAt: "2026-03-15T12:00:00.000Z", total: 20, customerId: "3" },
  { reference: "D", arrivedAt: "2026-03-30T12:00:00.000Z", total: 30, customerId: "1" },
  { reference: "E", arrivedAt: "2026-04-03T12:00:00.000Z", total: 40, customerId: null }
]);

/**
 * An orders list served as an application serves one with structured filters: the filter contract's validator at the
 * route and action, its search schema on the orders table, and its toJsonRestQuery in the service's list, over Fastify.
 * @param {import("node:test").TestContext} t
 * @param {object} definitions The list filters.
 * @param {Record<string, string>} columns Each filter's field, when it is not the filter's own key.
 */
async function ordersApp(t, definitions, columns) {
  const knex = await createPackageTestKnex(t, { environment: process.env });
  const filters = createCrudListFilterContract(definitions, { columns });
  const router = createRouter();
  const started = await startTestFeatures({
    knex,
    features: [
      CrudContractsProvider,
      defineCrudFeature({
        crud: defineCrudContract(orders, {
          namespace: "orders",
          apiAccess: "public",
          operations: ["list", "view"],
          fields: { reference: { output: "required" } }
        }),
        operations: ["list"],
        surface: "app",
        owns: [{ resource: orders, searchSchema: filters.jsonRestSearchSchema }],
        listFilterQueryValidator: filters.queryValidator,
        decorateService: ({ service }) => ({ ...service, list: (query, options) => service.list(filters.toJsonRestQuery(query), options) })
      })
    ],
    requires: { actions: "runtime.actions", orders: "crud.orders" },
    inputs: { "runtime.http": { router } },
    createTables: true
  });
  t.after(started.stop);
  const context = started.resources.declareSystemScope("test.orders", "The test seeds every order.")("seed the orders");
  for (const order of ORDERS) {
    await started.capabilities.orders.repository.create(order, { context, returning: "none" });
  }
  const app = Fastify();
  t.after(() => app.close());
  registerApiErrorHandler(app);
  registerRoutes(app, { routes: router.list(), actions: started.capabilities.actions });
  return async function list(query) {
    const response = await app.inject({ method: "GET", url: `/api/orders?${query}` });
    return {
      statusCode: response.statusCode,
      body: response.body,
      references: response.statusCode === 200 ? response.json().data.map((record) => record.attributes.reference).sort() : null
    };
  };
}

test("a date range or number range list filter sent over HTTP answers exactly the rows inside it", async (t) => {
  // arrival and arrivedOn are mapped to the arrivedAt field; total filters its own field.
  const list = await ordersApp(t, {
    arrival: { type: "dateRange", label: "Arrival" },
    arrivedOn: { type: "date", label: "Arrived on" },
    total: { type: "numberRange", label: "Total" }
  }, { arrival: "arrivedAt", arrivedOn: "arrivedAt" });

  for (const [query, references] of [
    ["filter%5Barrival%5D=2026-03-01..2026-03-31", ["B", "C", "D"]],
    ["filter%5Barrival%5D=2026-03-10..", ["C", "D", "E"]],
    ["filter%5Barrival%5D=..2026-03-10", ["A", "B"]],
    ["filter%5Barrival%5D=2026-03-15", ["C"]],
    ["filter%5BarrivedOn%5D=2026-03-30", ["D"]],
    ["filter%5Btotal%5D=15..35", ["C", "D"]],
    ["filter%5Btotal%5D=..10", ["A", "B"]],
    ["filter%5Barrival%5D=2026-03-01..2026-03-31&filter%5Btotal%5D=15..", ["C", "D"]],
    ["page%5Blimit%5D=20", ["A", "B", "C", "D", "E"]]
  ]) {
    const response = await list(query);
    // Before, a range answered 400: the list action read the route's parsed { from, to } again and refused it. Past
    // that, the service's toJsonRestQuery dropped it, and a date bound "2026-03-01 00:00:00" was refused with 422.
    assert.equal(response.statusCode, 200, `${query}: ${response.body}`);
    assert.deepEqual(response.references, references, query);
  }

  for (const query of ["filter%5Barrival%5D=March", "filter%5Barrival%5D=2026-03-01..soon", "filter%5Btotal%5D=lots", "filter%5Btotal%5D=1..x"]) {
    assert.equal((await list(query)).statusCode, 400, query);
  }
});
