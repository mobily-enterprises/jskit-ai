import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveCrudLookupProviderToken,
  createCrudLookupProviderResolver,
  createCrudLookupProvider
} from "../src/server/lookupProviders.js";

test("resolveCrudLookupProviderToken normalizes namespace to lookup token", () => {
  assert.equal(resolveCrudLookupProviderToken("vets"), "crud.lookup.vets");
  assert.equal(resolveCrudLookupProviderToken("vets/clinics/"), "crud.lookup.vets.clinics");
  assert.equal(resolveCrudLookupProviderToken("contact-categories"), "crud.lookup.contact_categories");
  assert.equal(resolveCrudLookupProviderToken("customer-categories/line-items"), "crud.lookup.customer_categories.line_items");
});

test("resolveCrudLookupProviderToken throws for empty namespace", () => {
  assert.throws(
    () => resolveCrudLookupProviderToken(""),
    /requires relation\.namespace/
  );
});

test("createCrudLookupProviderResolver resolves providers through scope.make()", () => {
  const calls = [];
  const scope = {
    make(token) {
      calls.push(token);
      return { token };
    }
  };

  const resolveLookupProvider = createCrudLookupProviderResolver(scope, {
    context: "customersProvider"
  });

  const resolved = resolveLookupProvider({
    namespace: "vets"
  });

  assert.equal(calls[0], "crud.lookup.vets");
  assert.deepEqual(resolved, {
    token: "crud.lookup.vets"
  });
});

test("createCrudLookupProvider wraps repository.listByIds and preserves include when provided", async () => {
  const calls = [];
  const provider = createCrudLookupProvider({
    async listByIds(ids = [], options = {}) {
      calls.push({
        ids,
        options
      });
      return [{ id: 1 }];
    }
  });

  const result = await provider.listByIds([1, 2], {
    include: "*",
    limit: 10
  });

  assert.deepEqual(result, [{ id: 1 }]);
  assert.deepEqual(calls[0], {
    ids: [1, 2],
    options: {
      include: "*",
      limit: 10
    }
  });
});

test("createCrudLookupProvider defaults include=none when include is not provided", async () => {
  const calls = [];
  const provider = createCrudLookupProvider({
    async listByIds(ids = [], options = {}) {
      calls.push({
        ids,
        options
      });
      return [{ id: 1 }];
    }
  });

  await provider.listByIds([1, 2], {
    limit: 10
  });

  assert.deepEqual(calls[0], {
    ids: [1, 2],
    options: {
      include: "none",
      limit: 10
    }
  });
});

test("createCrudLookupProvider validates repository contract", () => {
  assert.throws(
    () => createCrudLookupProvider({}),
    /requires repository\.listByIds/
  );
});
