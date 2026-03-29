import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CRUD_LOOKUP_CONTAINER_KEY,
  normalizeCrudLookupApiPath,
  normalizeCrudLookupContainerKey,
  resolveCrudLookupContainerKey
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
