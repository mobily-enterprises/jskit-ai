import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveCrudLookupToken,
  createCrudLookupResolver,
  createCrudLookup
} from "../src/server/lookups.js";

test("resolveCrudLookupToken normalizes namespace to lookup token", () => {
  assert.equal(resolveCrudLookupToken("vets"), "lookup.vets");
  assert.equal(resolveCrudLookupToken("vets/clinics/"), "lookup.vets.clinics");
  assert.equal(resolveCrudLookupToken("contact-categories"), "lookup.contact_categories");
  assert.equal(resolveCrudLookupToken("customer-categories/line-items"), "lookup.customer_categories.line_items");
});

test("resolveCrudLookupToken throws for empty namespace", () => {
  assert.throws(
    () => resolveCrudLookupToken(""),
    /requires relation\.namespace/
  );
});

test("createCrudLookupResolver resolves lookups through scope.make()", () => {
  const calls = [];
  const scope = {
    make(token) {
      calls.push(token);
      return { token };
    }
  };

  const resolveLookup = createCrudLookupResolver(scope, {
    context: "customersProvider"
  });

  const resolved = resolveLookup({
    namespace: "vets"
  });

  assert.equal(calls[0], "lookup.vets");
  assert.deepEqual(resolved, {
    token: "lookup.vets"
  });
});

test("createCrudLookup wraps repository.listByIds and preserves include when provided", async () => {
  const calls = [];
  const lookup = createCrudLookup({
    ownershipFilter: "workspace",
    async listByIds(ids = [], options = {}) {
      calls.push({
        ids,
        options
      });
      return [{ id: 1 }];
    }
  });

  const result = await lookup.listByIds([1, 2], {
    include: "*",
    limit: 10
  });

  assert.deepEqual(result, [{ id: 1 }]);
  assert.equal(lookup.ownershipFilter, "workspace");
  assert.deepEqual(calls[0], {
    ids: [1, 2],
    options: {
      include: "*",
      limit: 10
    }
  });
});

test("createCrudLookup defaults include=none when include is not provided", async () => {
  const calls = [];
  const lookup = createCrudLookup({
    async listByIds(ids = [], options = {}) {
      calls.push({
        ids,
        options
      });
      return [{ id: 1 }];
    }
  });

  await lookup.listByIds([1, 2], {
    limit: 10
  });

  assert.deepEqual(calls[0], {
    ids: [1, 2],
    options: {
      include: "none",
      limit: 10
    }
  });
  assert.equal(lookup.ownershipFilter, null);
});

test("createCrudLookup accepts ownershipFilter option override", () => {
  const lookup = createCrudLookup(
    {
      ownershipFilter: "workspace",
      async listByIds() {
        return [];
      }
    },
    {
      ownershipFilter: "public"
    }
  );

  assert.equal(lookup.ownershipFilter, "public");
});

test("createCrudLookup validates ownershipFilter token", () => {
  assert.throws(
    () =>
      createCrudLookup({
        ownershipFilter: "workspace-only",
        async listByIds() {
          return [];
        }
      }),
    /must be one of/
  );
});

test("createCrudLookup validates repository contract", () => {
  assert.throws(
    () => createCrudLookup({}),
    /requires repository\.listByIds/
  );
});
