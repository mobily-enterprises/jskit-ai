import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";
import {
  inferCrudJsonApiTransport,
  resolveCrudJsonApiTransport,
  resolveLookupFieldMap
} from "../src/client/composables/crud/crudJsonApiTransportSupport.js";

const resource = {
  namespace: "pets",
  contract: {
    lookup: {
      containerKey: "lookups"
    }
  },
  operations: {
    view: {
      output: {
        schema: createSchema({
          id: {
            type: "string",
            required: true
          },
          contactId: {
            type: "string",
            required: true,
            belongsTo: "contacts",
            as: "contact"
          },
          breedId: {
            type: "string",
            nullable: true,
            belongsTo: "breeds",
            as: "breed"
          }
        })
      }
    }
  }
};

test("inferCrudJsonApiTransport infers collection transport for CRUD lists", () => {
  assert.deepEqual(
    inferCrudJsonApiTransport(resource, {
      mode: "list"
    }),
    {
      kind: "jsonapi-resource",
      responseType: "pets",
      responseKind: "collection"
    }
  );
});

test("inferCrudJsonApiTransport infers record request/response transport for CRUD add/edit", () => {
  assert.deepEqual(
    inferCrudJsonApiTransport(resource, {
      mode: "add-edit",
      operationName: "patch"
    }),
    {
      kind: "jsonapi-resource",
      requestType: "pets",
      responseType: "pets",
      responseKind: "record"
    }
  );
});

test("resolveLookupFieldMap derives lookup aliases from the shared CRUD resource", () => {
  assert.deepEqual(resolveLookupFieldMap(resource), {
    breed: "breedId",
    contact: "contactId"
  });
});

test("resolveCrudJsonApiTransport infers and enriches JSON:API transport from the resource", () => {
  assert.deepEqual(
    resolveCrudJsonApiTransport(undefined, resource, {
      mode: "list"
    }),
    {
      kind: "jsonapi-resource",
      responseType: "pets",
      responseKind: "collection",
      lookupContainerKey: "lookups",
      lookupFieldMap: {
        breed: "breedId",
        contact: "contactId"
      }
    }
  );
});

test("resolveCrudJsonApiTransport infers record request/response transport for CRUD add/edit", () => {
  assert.deepEqual(
    resolveCrudJsonApiTransport(undefined, resource, {
      mode: "add-edit",
      operationName: "patch"
    }),
    {
      kind: "jsonapi-resource",
      requestType: "pets",
      responseType: "pets",
      responseKind: "record",
      lookupContainerKey: "lookups",
      lookupFieldMap: {
        breed: "breedId",
        contact: "contactId"
      }
    }
  );
});

test("resolveCrudJsonApiTransport rejects explicit CRUD transport overrides", () => {
  assert.throws(
    () =>
      resolveCrudJsonApiTransport(
        {
          kind: "jsonapi-resource",
          responseType: "pets",
          responseKind: "record"
        },
        resource,
        {
          mode: "view"
        }
      ),
    /no longer accept explicit transport/
  );
});
