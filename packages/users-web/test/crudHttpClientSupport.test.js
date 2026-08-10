import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeCrudApiAccess,
  resolveCrudHttpClient
} from "../src/client/composables/crud/crudHttpClientSupport.js";
import {
  __testables as crudListScreenTestables
} from "../src/client/composables/useCrudListScreen.js";

test("resolveCrudHttpClient injects per-request CSRF opt-out for public resources", async () => {
  const calls = [];
  const configuredClient = {
    async request(url, options) {
      calls.push([url, options]);
      return { ok: true };
    }
  };
  const client = resolveCrudHttpClient({ apiAccess: "public" }, {
    client: configuredClient
  });

  for (const method of ["POST", "PATCH", "DELETE"]) {
    await client.request("/api/books/1", {
      method,
      csrf: true
    });
  }

  assert.deepEqual(
    calls.map(([url, options]) => [url, options.method, options.csrf]),
    [
      ["/api/books/1", "POST", false],
      ["/api/books/1", "PATCH", false],
      ["/api/books/1", "DELETE", false]
    ]
  );
});

test("resolveCrudHttpClient preserves the configured client for authenticated resources", () => {
  const configuredClient = {
    request() {}
  };

  assert.equal(
    resolveCrudHttpClient({ apiAccess: "authenticated" }, { client: configuredClient }),
    configuredClient
  );
  assert.equal(
    resolveCrudHttpClient({}, { client: configuredClient }),
    configuredClient
  );
  assert.equal(normalizeCrudApiAccess(""), "authenticated");
  assert.throws(
    () => resolveCrudHttpClient({ apiAccess: "always" }, { client: configuredClient }),
    /apiAccess must be one of: authenticated, public/
  );
});

test("CRUD list row and bulk action context carries the resource-aware client", () => {
  const records = {
    reload() {}
  };
  const client = {
    request() {}
  };

  assert.deepEqual(
    crudListScreenTestables.buildCrudListActionContext(records, client),
    {
      records,
      reload: records.reload,
      client
    }
  );
});
