import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { catalogMessage, formatMessage, messageKeyForCode, mergeCatalogs } from "@jskit-ai/kernel/shared/i18n";
import kernelEnglish from "@jskit-ai/kernel/locales/en.json" with { type: "json" };
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { defineCrudContract } from "@jskit-ai/resource-crud-core/shared/crudContract";
import { returnJsonApiDocument } from "@jskit-ai/http-runtime/shared";
import { createRouter } from "../../kernel/server/http/lib/router.js";
import { registerRoutes } from "../../kernel/server/http/lib/routeRegistration.js";
import { registerApiErrorHandler } from "../../kernel/server/http/errorHandling.js";
import crudEnglish from "../locales/en.json" with { type: "json" };
import { registerCrudJsonApiRoutes } from "../src/server/jsonApiModule/routes.js";
import { crudJsonApiRouteOptions } from "./support/crudJsonApiActionOptions.js";

const notes = defineCrudContract(defineTableResource({
  name: "notes",
  tableName: "notes",
  ownership: "public",
  schema: { title: { type: "string", required: true } }
}), {
  namespace: "notes",
  apiAccess: "public",
  operations: ["list", "view"],
  fields: { title: { output: "required" } }
});

async function listApp(t) {
  const router = createRouter();
  registerCrudJsonApiRoutes(router, crudJsonApiRouteOptions({
    namespace: "notes",
    resource: notes,
    relativePath: "/notes",
    surface: "app",
    ownershipFilter: "public",
    access: "public",
    operations: ["list"]
  }));
  // The server's warnings, as the lines its logger writes.
  const warnings = [];
  const app = Fastify({ logger: { level: "warn", stream: { write: (line) => warnings.push(JSON.parse(line)) } } });
  t.after(() => app.close());
  registerApiErrorHandler(app);
  const listed = [];
  registerRoutes(app, {
    routes: router.list(),
    actions: {
      getDefinition: () => ({ kind: "action" }),
      async execute({ input }) {
        listed.push(input);
        return returnJsonApiDocument({ data: [] });
      }
    }
  });
  return { app, listed, warnings };
}

test("a CRUD list refuses a query key it does not take, which Fastify's validation would drop unseen", async (t) => {
  const { app, listed, warnings } = await listApp(t);

  const searched = await app.inject({ method: "GET", url: "/api/notes?filter%5Bq%5D=Ada" });
  assert.equal(searched.statusCode, 200, searched.body);
  assert.deepEqual(listed, [{ q: "Ada" }]);

  // Every key JSKIT's list composables send is taken: the page, its cursor, the search, include and a sparse fieldset.
  const paged = await app.inject({
    method: "GET",
    url: "/api/notes?page%5Blimit%5D=20&page%5Bcursor%5D=5&filter%5Bq%5D=Ada&include=author&fields%5Bnotes%5D=title"
  });
  assert.equal(paged.statusCode, 200, paged.body);
  assert.equal(listed.length, 2);

  // Before, both answered every row: validation dropped the filter and the list never saw it.
  const english = mergeCatalogs(kernelEnglish, crudEnglish);
  for (const [url, unknownKey] of [["/api/notes?filter%5Bstatus%5D=open", "filter[status]"], ["/api/notes?filter%5Bq%5D=Ada&status=open", "status"]]) {
    warnings.length = 0;
    const response = await app.inject({ method: "GET", url });
    assert.equal(response.statusCode, 400, url);
    const [error] = response.json().errors;
    assert.equal(error.code, "crud.query.undeclaredKeys", url);
    // The person reads a plain sentence; the client shows the code's sentence in their language, as the English sent
    // is the catalog's. Before, it was the developer's text below, which a list screen showed as its notice.
    assert.equal(error.title,
      "This page asked for something the server doesn't recognise, so nothing was loaded. Reload the page; if it " +
      "keeps happening, tell support.", url);
    assert.equal(formatMessage(catalogMessage(english, messageKeyForCode(error.code)), {}), error.title, url);
    assert.doesNotMatch(response.body, /listFilterQueryValidator|does not take/u, url);
    // What a developer needs to fix it is in the server log.
    assert.equal(warnings.length, 1, url);
    assert.equal(warnings[0].code, "crud.query.undeclaredKeys", url);
    assert.deepEqual(warnings[0].unknown, [unknownKey], url);
    assert.match(warnings[0].msg, new RegExp(`does not take ${unknownKey.replace(/[[\]]/gu, "\\$&")}:`, "u"), url);
    assert.match(warnings[0].msg, /It takes .*filter\[q\].*fields\[<type>\].*listFilterQueryValidator/u, url);
  }
  assert.equal(listed.length, 2);
});

test("a CRUD list takes filter[id], one record id or several, which a lookup sends to label the values it holds", async (t) => {
  const { app, listed } = await listApp(t);

  for (const url of ["/api/notes?filter%5Bid%5D=7", "/api/notes?filter%5Bid%5D=7&filter%5Bid%5D=12&page%5Blimit%5D=20", "/api/notes?filter%5Bid%5D=7,12"]) {
    const response = await app.inject({ method: "GET", url });
    assert.equal(response.statusCode, 200, `${url}: ${response.body}`);
  }
  assert.deepEqual(listed.map((input) => input.id), [["7"], ["7", "12"], ["7", "12"]]);
});
