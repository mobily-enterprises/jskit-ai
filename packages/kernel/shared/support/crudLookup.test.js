import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CRUD_LOOKUP_CONTAINER_KEY,
  normalizeCrudLookupApiPath,
  normalizeCrudLookupContainerKey,
  resolveCrudLookupContainerKey,
  resolveCrudLookupFieldKeys
} from "./crudLookup.js";

test("normalizeCrudLookupApiPath normalizes and rejects root", () => {
  assert.equal(normalizeCrudLookupApiPath("vets"), "/vets");
  assert.equal(normalizeCrudLookupApiPath("/vets//"), "/vets");
  assert.equal(normalizeCrudLookupApiPath("/"), "");
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
