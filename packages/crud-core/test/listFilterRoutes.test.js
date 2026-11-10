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
    customerId: { type: "id", nullable: true, storage: { column: "customer_id" } },
    // A day held as text ("2026-03-05"), the same on every database, which only a custom apply filters.
    dueOn: { type: "string", nullable: true, storage: { column: "due_on" } }
  }
});

// Each arrives at noon UTC, well inside its day in any time zone.
const ORDERS = Object.freeze([
  { reference: "A", arrivedAt: "2026-02-27T12:00:00.000Z", total: 5, customerId: "1", dueOn: "2026-02-28" },
  { reference: "B", arrivedAt: "2026-03-02T12:00:00.000Z", total: 10, customerId: "2", dueOn: "2026-03-05" },
  { reference: "C", arrivedAt: "2026-03-15T12:00:00.000Z", total: 20, customerId: "3", dueOn: "2026-03-20" },
  { reference: "D", arrivedAt: "2026-03-30T12:00:00.000Z", total: 30, customerId: "1", dueOn: "2026-03-31" },
  { reference: "E", arrivedAt: "2026-04-03T12:00:00.000Z", total: 40, customerId: null, dueOn: null }
]);

/**
 * An orders list served as an application serves one with structured filters: the filter contract's validator at the
 * route and action, its search schema on the orders table, and its toJsonRestQuery in the service's list, over Fastify.
 * @param {import("node:test").TestContext} t
 * @param {object} definitions The list filters.
 * @param {Record<string, string>} columns Each filter's field, when it is not the filter's own key.
 * @param {Record<string, Function>} [apply] The filters with a custom apply.
 */
async function ordersApp(t, definitions, columns, apply = {}) {
  const knex = await createPackageTestKnex(t, { environment: process.env });
  const filters = createCrudListFilterContract(definitions, { columns, apply });
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

test("a date, date range or number range list filter with a custom apply answers its rows over HTTP", async (t) => {
  // A default date filter compares dateTime instants, so the due day, held as text, is compared by custom applies.
  // Each records the value it receives: the filter's parsed value, as applyQuery hands it.
  const received = [];
  const list = await ordersApp(t, {
    due: { type: "dateRange", label: "Due" },
    dueBy: { type: "date", label: "Due by" },
    spend: { type: "numberRange", label: "Spend" }
  }, {}, {
    due(queryBuilder, value) {
      received.push(["due", value]);
      if (value.from) queryBuilder.where("due_on", ">=", value.from);
      if (value.to) queryBuilder.where("due_on", "<=", value.to);
    },
    // Due on or before the day, where a default date filter takes only that day.
    dueBy(queryBuilder, value) {
      received.push(["dueBy", value]);
      queryBuilder.where("due_on", "<=", value);
    },
    spend(queryBuilder, value) {
      received.push(["spend", value]);
      if (value.min != null) queryBuilder.where("total", ">=", value.min);
      if (value.max != null) queryBuilder.where("total", "<=", value.max);
    }
  });

  for (const [query, references, values] of [
    ["filter%5Bdue%5D=2026-03-01..2026-03-31", ["B", "C", "D"], [["due", { from: "2026-03-01", to: "2026-03-31" }]]],
    ["filter%5Bdue%5D=2026-03-21..", ["D"], [["due", { from: "2026-03-21" }]]],
    ["filter%5Bdue%5D=..2026-03-05", ["A", "B"], [["due", { to: "2026-03-05" }]]],
    ["filter%5Bdue%5D=2026-03-20", ["C"], [["due", { from: "2026-03-20", to: "2026-03-20" }]]],
    ["filter%5BdueBy%5D=2026-03-05", ["A", "B"], [["dueBy", "2026-03-05"]]],
    ["filter%5Bspend%5D=15..35", ["C", "D"], [["spend", { min: 15, max: 35 }]]],
    ["filter%5BdueBy%5D=2026-03-25&filter%5Bspend%5D=10..", ["B", "C"], [["dueBy", "2026-03-25"], ["spend", { min: 10 }]]]
  ]) {
    received.length = 0;
    const response = await list(query);
    // Before, toJsonRestQuery sent such a filter as __jskit_<key>_from/_toExclusive (or _min/_max), keys its search
    // schema did not declare, so json-rest-api refused the list with 422 "Field not allowed".
    assert.equal(response.statusCode, 200, `${query}: ${response.body}`);
    assert.deepEqual(response.references, references, query);
    assert.deepEqual(received, values, query);
  }

  for (const query of ["filter%5Bdue%5D=March", "filter%5BdueBy%5D=2026-03-01..2026-03-05", "filter%5Bspend%5D=lots"]) {
    assert.equal((await list(query)).statusCode, 400, query);
  }
});

test("a recordIdMany list filter builds its search schema and answers the rows of the ids sent over HTTP", async (t) => {
  // Before, json-rest-schema refused the filter's search schema entry, whose items were a JSON Schema anyOf, so the
  // orders feature did not start.
  const list = await ordersApp(t, { customer: { type: "recordIdMany", label: "Customer" } }, { customer: "customerId" });

  for (const [query, references] of [
    ["filter%5Bcustomer%5D=1&filter%5Bcustomer%5D=2", ["A", "B", "D"]],
    ["filter%5Bcustomer%5D=1,2", ["A", "B", "D"]],
    ["filter%5Bcustomer%5D=1&filter%5Bcustomer%5D=3", ["A", "C", "D"]],
    ["filter%5Bcustomer%5D=3", ["C"]],
    ["filter%5Bcustomer%5D=9", []]
  ]) {
    const response = await list(query);
    assert.equal(response.statusCode, 200, `${query}: ${response.body}`);
    assert.deepEqual(response.references, references, query);
  }

  for (const query of ["filter%5Bcustomer%5D=abc", "filter%5Bcustomer%5D=1,,2", "filter%5Bcustomer%5D=0"]) {
    assert.equal((await list(query)).statusCode, 400, query);
  }
});
