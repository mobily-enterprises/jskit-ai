import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CRUD_LOOKUP_CONTAINER_KEY,
  normalizeCrudLookupApiPath,
  normalizeCrudLookupNamespace,
  resolveCrudLookupApiPathFromNamespace,
  normalizeCrudLookupContainerKey,
  resolveCrudLookupContainerKey,
  resolveCrudLookupFieldKeys,
  resolveCrudLookupFieldKeyFromRouteParam
} from "./crudLookup.js";

test("normalizeCrudLookupApiPath normalizes and rejects root", () => {
  assert.equal(normalizeCrudLookupApiPath("vets"), "/vets");
  assert.equal(normalizeCrudLookupApiPath("/vets//"), "/vets");
  assert.equal(normalizeCrudLookupApiPath("/"), "");
});

test("normalizeCrudLookupNamespace normalizes namespace-like values", () => {
  assert.equal(normalizeCrudLookupNamespace("vets"), "vets");
  assert.equal(normalizeCrudLookupNamespace("/customer-categories//"), "customer-categories");
  assert.equal(normalizeCrudLookupNamespace("/"), "");
});

test("resolveCrudLookupApiPathFromNamespace maps namespace to api path", () => {
  assert.equal(resolveCrudLookupApiPathFromNamespace("vets"), "/vets");
  assert.equal(resolveCrudLookupApiPathFromNamespace("/customer-categories"), "/customer-categories");
  assert.equal(resolveCrudLookupApiPathFromNamespace(""), "");
});

test("normalizeCrudLookupContainerKey defaults to canonical value", () => {
  assert.equal(normalizeCrudLookupContainerKey(undefined), DEFAULT_CRUD_LOOKUP_CONTAINER_KEY);
  assert.equal(normalizeCrudLookupContainerKey(""), DEFAULT_CRUD_LOOKUP_CONTAINER_KEY);
});

test("resolveCrudLookupContainerKey reads resource contract override", () => {
  assert.equal(
    resolveCrudLookupContainerKey({
      contract: {
        lookup: {
          containerKey: "lookupData"
        }
      }
    }),
    "lookupData"
  );
});

test("resolveCrudLookupContainerKey throws for invalid contract shape", () => {
  assert.throws(
    () => resolveCrudLookupContainerKey({ contract: { lookup: [] } }),
    /contract\.lookup must be an object/
  );
});

test("resolveCrudLookupFieldKeys returns lookup field keys with optional allow-list", () => {
  const resource = {
    fieldMeta: [
      {
        key: "contactId",
        relation: {
          kind: "lookup",
          apiPath: "/contacts",
          valueKey: "id"
        }
      },
      {
        key: "status"
      },
      {
        key: "vetId",
        parentRouteParamKey: "primaryVetId",
        relation: {
          kind: "lookup",
          apiPath: "/vets",
          valueKey: "id"
        }
      }
    ]
  };

  assert.deepEqual(resolveCrudLookupFieldKeys(resource), ["contactId", "vetId"]);
  assert.deepEqual(resolveCrudLookupFieldKeys(resource, { allowKeys: ["vetId", "missing"] }), ["vetId"]);
});

test("resolveCrudLookupFieldKeyFromRouteParam matches parent route param aliases to canonical lookup field keys", () => {
  const resource = {
    fieldMeta: [
      {
        key: "staffContactId",
        parentRouteParamKey: "contactId",
        relation: {
          kind: "lookup",
          apiPath: "/contacts",
          valueKey: "id"
        }
      },
      {
        key: "serviceId",
        relation: {
          kind: "lookup",
          apiPath: "/services",
          valueKey: "id"
        }
      }
    ]
  };

  assert.equal(resolveCrudLookupFieldKeyFromRouteParam(resource, "contactId"), "staffContactId");
  assert.equal(resolveCrudLookupFieldKeyFromRouteParam(resource, "staffContactId"), "staffContactId");
  assert.equal(resolveCrudLookupFieldKeyFromRouteParam(resource, "serviceId"), "serviceId");
  assert.equal(resolveCrudLookupFieldKeyFromRouteParam(resource, "unknown"), "");
  assert.equal(
    resolveCrudLookupFieldKeyFromRouteParam(resource, "contactId", { allowKeys: ["serviceId"] }),
    ""
  );
});
