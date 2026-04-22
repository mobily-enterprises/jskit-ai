import assert from "node:assert/strict";
import test from "node:test";
import { appendRequestQueryEntriesToPath } from "../src/client/composables/support/requestQueryPathSupport.js";

test("appendRequestQueryEntriesToPath appends request query params deterministically", () => {
  assert.equal(
    appendRequestQueryEntriesToPath("/api/w/dev-admin/contacts/1", [
      { key: "include", values: ["vetId", "linkedUserId", "pets", "pets.breedId"] },
      { key: "limit", values: ["10"] }
    ]),
    "/api/w/dev-admin/contacts/1?include=vetId&include=linkedUserId&include=pets&include=pets.breedId&limit=10"
  );
});

test("appendRequestQueryEntriesToPath leaves the base path unchanged when no request params are active", () => {
  assert.equal(
    appendRequestQueryEntriesToPath("/api/w/dev-admin/contacts/1", []),
    "/api/w/dev-admin/contacts/1"
  );
});
