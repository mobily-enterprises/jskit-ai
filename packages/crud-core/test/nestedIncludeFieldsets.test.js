import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { catalogMessage, formatMessage, messageKeyForCode, mergeCatalogs } from "@jskit-ai/kernel/shared/i18n";
import kernelEnglish from "@jskit-ai/kernel/locales/en.json" with { type: "json" };
import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createPackageTestKnex, startTestFeatures } from "@jskit-ai/resource-runtime/test";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { defineCrudContract } from "@jskit-ai/resource-crud-core/shared/crudContract";
import { createRouter } from "../../kernel/server/http/lib/router.js";
import { registerRoutes } from "../../kernel/server/http/lib/routeRegistration.js";
import { registerApiErrorHandler } from "../../kernel/server/http/errorHandling.js";
import crudEnglish from "../locales/en.json" with { type: "json" };
import { CrudContractsProvider } from "../src/server/crudContracts.js";
import { defineCrudFeature } from "../src/server/defineCrudFeature.js";

const english = mergeCatalogs(kernelEnglish, crudEnglish);
const API = Object.freeze({ channel: "api", surface: "home" });
const INCLUDE = "customer,customer.region";

// orders -> customer (customers) -> region (regions), two levels deep; no include reaches tags.
const regions = defineTableResource({
  name: "regions",
  tableName: "regions",
  ownership: "public",
  schema: {
    name: { type: "string", required: true },
    code: { type: "string", nullable: true },
    secret: { type: "string", nullable: true }
  }
});
const customers = defineTableResource({
  name: "customers",
  tableName: "customers",
  ownership: "public",
  schema: {
    name: { type: "string", required: true },
    regionId: { type: "id", nullable: true, lookup: "regions", storage: { column: "region_id" } }
  }
});
const tags = defineTableResource({
  name: "tags",
  tableName: "tags",
  ownership: "public",
  schema: { label: { type: "string", required: true } }
});
const orders = defineTableResource({
  name: "orders",
  tableName: "orders",
  ownership: "public",
  schema: {
    reference: { type: "string", required: true },
    customerId: { type: "id", nullable: true, lookup: "customers", storage: { column: "customer_id" } }
  }
});
const ordersContract = defineCrudContract(orders, {
  namespace: "orders",
  apiAccess: "public",
  operations: ["list", "view"],
  fields: {
    reference: { output: "required" },
    customerId: { output: { required: false, includeFields: ["name", { region: ["name", "code"] }] } }
  }
});
// invoices -> customer (customers), one level: nothing to defer, so the list's input schema judges every fieldset key.
const invoices = defineTableResource({
  name: "invoices",
  tableName: "invoices",
  ownership: "public",
  schema: {
    number: { type: "string", required: true },
    customerId: { type: "id", nullable: true, lookup: "customers", storage: { column: "customer_id" } }
  }
});
const invoicesContract = defineCrudContract(invoices, {
  namespace: "invoices",
  apiAccess: "public",
  operations: ["list", "view"],
  fields: {
    number: { output: "required" },
    customerId: { output: { required: false, includeFields: ["name"] } }
  }
});

// The orders and invoices features serve their records; another feature owns the tables their includes reach.
async function startOrders(t) {
  const knex = await createPackageTestKnex(t, { environment: process.env });
  const router = createRouter();
  const started = await startTestFeatures({
    knex,
    features: [
      CrudContractsProvider,
      defineFeature({ id: "test.customers", owns: [customers, regions, tags], setup: () => ({}) }),
      defineCrudFeature({ crud: ordersContract, surface: "home" }),
      defineCrudFeature({ crud: invoicesContract, surface: "home" })
    ],
    requires: { actions: "runtime.actions" },
    inputs: { "runtime.http": { router } },
    createTables: true
  });
  t.after(started.stop);
  await knex("regions").insert({ name: "North", code: "N", secret: "private" });
  await knex("customers").insert({ name: "Acme", region_id: 1 });
  await knex("tags").insert({ label: "Urgent" });
  await knex("orders").insert({ reference: "A-1", customer_id: 1 });
  await knex("invoices").insert({ number: "INV-1", customer_id: 1 });
  return { actions: started.capabilities.actions, router };
}

function includedOf(document) {
  return document.included
    .map(({ type, attributes }) => [type, attributes])
    .sort(([left], [right]) => left.localeCompare(right));
}

// The client translates a code only when the server's English is the catalog's English for it, with its params.
function assertCatalogRenders({ code, params }, sentEnglish) {
  assert.equal(formatMessage(catalogMessage(english, messageKeyForCode(code)), params), sentEnglish, code);
}

test("a list or view narrows a record its include reaches two levels down with fields[<type>], to fields the include shows", async (t) => {
  const { actions } = await startOrders(t);
  const read = (actionId, fields, input = {}) => actions.execute({
    actionId,
    input: { ...input, include: INCLUDE, ...(fields ? { fields } : {}) },
    context: API
  });

  // The include shows the region's name and code; fields[regions] narrows the region, in a list and in a view.
  assert.deepEqual(includedOf((await read("crud.orders.list")).value), [
    ["customers", { name: "Acme" }],
    ["regions", { name: "North", code: "N" }]
  ]);
  for (const [actionId, input] of [["crud.orders.list", {}], ["crud.orders.view", { recordId: "1" }]]) {
    assert.deepEqual(includedOf((await read(actionId, { regions: ["name"] }, input)).value), [
      ["customers", { name: "Acme" }],
      ["regions", { name: "North" }]
    ], actionId);
  }

  // A field the include does not show, and a type no include reaches, stay refused.
  for (const [fields, code, english] of [
    [{ regions: ["secret"] }, "crud.query.fieldsNotShown", /^fields\[regions\] may name only what this read's includes show of regions: name, code\. It names secret\.$/u],
    [{ tags: ["label"] }, "crud.query.fieldsKeysInvalidWithAliases", /Allowed keys: "orders", "customers", "regions"\./u]
  ]) {
    const [field] = Object.keys(fields).map((type) => `fields.${type}`);
    await assert.rejects(read("crud.orders.list", fields), (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.details.fieldErrorCodes[field].code, code);
      assert.match(error.details.fieldErrors[field], english);
      assertCatalogRenders(error.details.fieldErrorCodes[field], error.details.fieldErrors[field]);
      return true;
    });
  }
});

test("over HTTP, fields[<type>] narrows a record two include levels down and refuses unshown fields and unreached types", async (t) => {
  const { actions, router } = await startOrders(t);
  const app = Fastify();
  t.after(() => app.close());
  registerApiErrorHandler(app);
  registerRoutes(app, { routes: router.list(), actions });
  const { path } = router.list().find((route) => route.method === "GET" && route.path.endsWith("/orders"));
  const get = (query) => app.inject({ method: "GET", url: `${path}?include=${INCLUDE}&${query}` });

  const narrowed = await get("fields%5Bregions%5D=name");
  assert.equal(narrowed.statusCode, 200, narrowed.body);
  assert.deepEqual(includedOf(narrowed.json()), [["customers", { name: "Acme" }], ["regions", { name: "North" }]]);

  for (const [query, code] of [
    ["fields%5Bregions%5D=secret", "crud.query.fieldsNotShown"],
    ["fields%5Btags%5D=label", "crud.query.fieldsKeysInvalidWithAliases"]
  ]) {
    const response = await get(query);
    assert.equal(response.statusCode, 400, `${query}: ${response.body}`);
    assert.ok(response.body.includes(`"${code}"`), `${query}: ${response.body}`);
  }
});

// The list action's input schema refuses a bad key of a contract whose includes stop at their first level; the check
// the action runs refuses it for one whose includes reach further. A client or an assistant tool reads both alike.
const BAD_KEYS = Object.freeze([
  [{ customer: ["name"] }, "fields.customer"],
  [{ nosuch: ["name"] }, "fields.nosuch"]
]);

test("a fieldset keyed by a relationship alias or by no type is refused as the action input refuses one, whether the includes reach nested types or not", async (t) => {
  const { actions } = await startOrders(t);
  const refusal = (actionId, fields) => actions.execute({ actionId, input: { include: "customer", fields }, context: API }).then(
    () => assert.fail(`${actionId} took fields ${JSON.stringify(fields)}`),
    (error) => error
  );

  for (const [fields, field] of BAD_KEYS) {
    const nested = await refusal("crud.orders.list", fields);
    const flat = await refusal("crud.invoices.list", fields);
    assert.equal(nested.constructor, flat.constructor);
    for (const [error, allowedKeys] of [[nested, '"orders", "customers", "regions"'], [flat, '"invoices", "customers"']]) {
      assert.equal(error.status, 400);
      assert.equal(error.code, "ACTION_VALIDATION_FAILED");
      assert.equal(error.message, "Validation failed.");
      assert.deepEqual(Object.keys(error.details.fieldErrors), [field]);
      assert.deepEqual(error.details.fieldErrorCodes[field], {
        code: "crud.query.fieldsKeysInvalidWithAliases",
        params: { allowedTypes: allowedKeys, aliasGuidance: 'use "customers" instead of "customer"' }
      });
      assert.equal(
        error.details.fieldErrors[field],
        `fields keys must be JSON:API resource types. Allowed keys: ${allowedKeys}. Relationship aliases are invalid ` +
        'keys; use "customers" instead of "customer".'
      );
      assertCatalogRenders(error.details.fieldErrorCodes[field], error.details.fieldErrors[field]);
    }
  }
});

test("over HTTP, a fieldset keyed by a relationship alias or by no type answers alike whether the includes reach nested types or not", async (t) => {
  const { actions, router } = await startOrders(t);
  const app = Fastify();
  t.after(() => app.close());
  registerApiErrorHandler(app);
  registerRoutes(app, { routes: router.list(), actions });
  const listPath = (namespace) => router.list().find((route) => route.method === "GET" && route.path.endsWith(`/${namespace}`)).path;

  for (const [fields, field] of BAD_KEYS) {
    const [type] = Object.keys(fields);
    const [nested, flat] = await Promise.all(["orders", "invoices"].map((namespace) => app.inject({
      method: "GET",
      url: `${listPath(namespace)}?include=customer&fields%5B${type}%5D=name`
    })));
    for (const response of [nested, flat]) {
      assert.equal(response.statusCode, 400, `${field}: ${response.body}`);
      for (const expected of ['"ACTION_VALIDATION_FAILED"', '"crud.query.fieldsKeysInvalidWithAliases"', 'use \\"customers\\" instead of \\"customer\\"']) {
        assert.ok(response.body.includes(expected), `${field} ${expected}: ${response.body}`);
      }
    }
  }
});
