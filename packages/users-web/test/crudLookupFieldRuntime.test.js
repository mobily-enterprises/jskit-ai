import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveLookupItemLabel,
  resolveLookupFieldDisplayValue
} from "../src/client/composables/crudLookupFieldLabelSupport.js";

test("resolveLookupItemLabel composes name + surname", () => {
  assert.equal(
    resolveLookupItemLabel(
      {
        name: "South",
        surname: "Clinic"
      },
      "name"
    ),
    "South Clinic"
  );
});

test("resolveLookupItemLabel composes firstName + surname", () => {
  assert.equal(
    resolveLookupItemLabel(
      {
        firstName: "Ana",
        surname: "Marin"
      },
      "name"
    ),
    "Ana Marin"
  );
});

test("resolveLookupItemLabel falls back to explicit labelKey", () => {
  assert.equal(
    resolveLookupItemLabel(
      {
        clinicName: "Harbor Vet"
      },
      "clinicName"
    ),
    "Harbor Vet"
  );
});

test("resolveLookupItemLabel resolves name when surname is missing", () => {
  assert.equal(
    resolveLookupItemLabel(
      {
        name: "Harbor Vet"
      },
      ""
    ),
    "Harbor Vet"
  );
});

test("resolveLookupItemLabel returns empty when no label fields match", () => {
  assert.equal(resolveLookupItemLabel({ id: 42 }, "name"), "");
});

test("resolveLookupFieldDisplayValue returns hydrated label for lookup fields", () => {
  assert.equal(
    resolveLookupFieldDisplayValue(
      {
        vetId: 17,
        lookups: {
          vetId: {
            id: 17,
            name: "Harbor Vet"
          }
        }
      },
      {
        key: "vetId",
        relation: {
          kind: "lookup",
          valueKey: "id",
          labelKey: "name"
        }
      }
    ),
    "Harbor Vet"
  );
});

test("resolveLookupFieldDisplayValue falls back to hydrated valueKey", () => {
  assert.equal(
    resolveLookupFieldDisplayValue(
      {
        vetId: 17,
        lookups: {
          vetId: {
            id: 99
          }
        }
      },
      {
        key: "vetId",
        relation: {
          kind: "lookup",
          valueKey: "id",
          labelKey: "name"
        }
      }
    ),
    99
  );
});

test("resolveLookupFieldDisplayValue falls back to raw id when lookup is not hydrated", () => {
  assert.equal(
    resolveLookupFieldDisplayValue(
      {
        vetId: 17
      },
      {
        key: "vetId",
        relation: {
          kind: "lookup",
          valueKey: "id",
          labelKey: "name"
        }
      }
    ),
    17
  );
});

test("resolveLookupFieldDisplayValue supports custom lookup container key", () => {
  assert.equal(
    resolveLookupFieldDisplayValue(
      {
        vetId: 17,
        lookupData: {
          vetId: {
            id: 17,
            name: "Harbor Vet"
          }
        }
      },
      {
        key: "vetId",
        relation: {
          kind: "lookup",
          containerKey: "lookupData",
          valueKey: "id",
          labelKey: "name"
        }
      }
    ),
    "Harbor Vet"
  );
});

test("resolveLookupFieldDisplayValue returns raw value for non-lookup fields", () => {
  assert.equal(
    resolveLookupFieldDisplayValue(
      {
        firstName: "Ana"
      },
      {
        key: "firstName"
      }
    ),
    "Ana"
  );
});
