import assert from "node:assert/strict";
import test from "node:test";
import { resolveLookupItemLabel } from "../src/client/composables/crudLookupFieldLabelSupport.js";

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
