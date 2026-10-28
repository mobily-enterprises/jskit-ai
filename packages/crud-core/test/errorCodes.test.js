import assert from "node:assert/strict";
import test from "node:test";
import { createSchema, validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { catalogMessage, formatMessage, messageKeyForCode, mergeCatalogs } from "@jskit-ai/kernel/shared/i18n";
import kernelEnglish from "@jskit-ai/kernel/locales/en.json" with { type: "json" };

import crudEnglish from "../locales/en.json" with { type: "json" };
import { normalizeCrudListCursor } from "../src/server/repositorySupport.js";
import {
  createJsonApiFieldsetsQueryValidator,
  jsonApiFieldsetsQueryValidator,
  lookupIncludeQueryValidator
} from "../src/server/listQueryValidators.js";
import { createCrudJsonApiService } from "../src/server/jsonApiModule/service.js";
import {
  createCrudServiceRuntime,
  crudServiceCreateRecord,
  crudServiceDeleteRecord,
  crudServiceGetRecord,
  crudServiceUpdateRecord
} from "../src/server/serviceMethods.js";

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
  const runtime = createCrudServiceRuntime({ namespace: "contacts" });
  const missingRepository = {
    async findById() {
      return null;
    },
    async create(payload) {
      return { id: 1, ...payload };
    },
    async deleteById() {
      return null;
    },
    async getDocumentById() {
      return null;
    }
  };

  const errors = [
    await rejection(() => crudServiceGetRecord(runtime, missingRepository, {}, 7, {})),
    await rejection(() => crudServiceUpdateRecord(runtime, missingRepository, {}, 7, {}, {})),
    await rejection(() => crudServiceDeleteRecord(runtime, missingRepository, {}, 7, {})),
    await rejection(() => crudServiceCreateRecord(runtime, missingRepository, {
      writable: () => ["name"],
      writeMode: "throw"
    }, { name: "Ada", role: "owner", secret: "x" }, {})),
    await rejection(() => createCrudJsonApiService({ repository: missingRepository }).getDocumentById(7)),
    await rejection(() => normalizeCrudListCursor("abc"))
  ];

  assert.deepEqual(errors.map((error) => [error.status, error.code]), [
    [404, "crud.record.notFound"],
    [404, "crud.record.notFound"],
    [404, "crud.record.notFound"],
    [403, "crud.fieldAccess.writeDenied"],
    [404, "crud.document.notFound"],
    [400, "INVALID_CURSOR"]
  ]);
  assert.deepEqual(errors[3].params, { fields: "role, secret" });
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
