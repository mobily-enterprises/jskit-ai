import assert from "node:assert/strict";
import test from "node:test";
import { createSchema, validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { catalogMessage, formatMessage, messageKeyForCode, mergeCatalogs } from "@jskit-ai/kernel/shared/i18n";
import kernelEnglish from "@jskit-ai/kernel/locales/en.json" with { type: "json" };
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { defineCrudContract } from "@jskit-ai/resource-crud-core/shared/crudContract";

import crudEnglish from "../locales/en.json" with { type: "json" };
import {
  createJsonApiFieldsetsQueryValidator,
  jsonApiFieldsetsQueryValidator,
  lookupIncludeQueryValidator
} from "../src/server/listQueryValidators.js";
import { createCrudService } from "../src/server/jsonApiModule/service.js";

const english = mergeCatalogs(kernelEnglish, crudEnglish);

// The client translates a code only when the server's English is the catalog's
// English for that code, rendered with the params.
function assertCatalogRenders({ code, params }, sentEnglish) {
  const template = catalogMessage(english, messageKeyForCode(code));
  assert.notEqual(template, undefined, `${code} has no English`);
  assert.equal(formatMessage(template, params), sentEnglish, code);
}

async function rejection(run) {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return assert.fail("expected an error");
}

test("crud-core errors carry codes and params rendering their English", async () => {
  const missingRepository = {
    async get() {
      return null;
    },
    async patch() {
      return null;
    }
  };
  const contacts = defineTableResource({ name: "contacts", tableName: "contacts", ownership: "public", schema: { name: { type: "string" } } });
  const crud = defineCrudContract(contacts, { namespace: "contacts", fields: { name: { output: "optional", create: "optional", patch: "optional" } } });
  const service = createCrudService({ repository: missingRepository, crud });
  const errors = [
    await rejection(() => service.view(7, {}, {})),
    await rejection(() => service.patch(7, { name: "Ada" }, {}))
  ];

  assert.deepEqual(errors.map((error) => [error.status, error.code]), [
    [404, "crud.document.notFound"],
    [404, "crud.document.notFound"]
  ]);
  for (const error of errors) {
    assertCatalogRenders(error, error.message);
  }
});

test("crud list query messages are coded field errors", () => {
  const resource = {
    namespace: "bookings",
    operations: {
      view: {
        output: {
          schema: createSchema({
            petId: { type: "integer", belongsTo: "pets", as: "pet", relation: { labelKey: "name" } }
          }),
          mode: "replace"
        }
      }
    }
  };
  const failures = [
    [lookupIncludeQueryValidator, { include: {} }, "include", "crud.query.includeInvalid"],
    [jsonApiFieldsetsQueryValidator, { fields: "petId" }, "fields", "crud.query.fieldsInvalid"],
    [createJsonApiFieldsetsQueryValidator({ resource }), { fields: "petId" }, "fields", "crud.query.fieldsByTypeInvalid"],
    [createJsonApiFieldsetsQueryValidator({ resource }), { fields: { pet: ["name"] } }, "fields.pet",
      "crud.query.fieldsKeysInvalidWithAliases"]
  ];

  for (const [validator, payload, field, code] of failures) {
    let error = null;
    try {
      validateSchemaPayload(validator, payload, { phase: "input" });
    } catch (caught) {
      error = caught;
    }
    assert.equal(error?.fieldErrorCodes?.[field]?.code, code, JSON.stringify(payload));
    assertCatalogRenders(error.fieldErrorCodes[field], error.fieldErrors[field]);
  }
});
