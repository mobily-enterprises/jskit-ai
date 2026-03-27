import assert from "node:assert/strict";
import test from "node:test";
import { reactive } from "vue";
import { Type } from "typebox";
import {
  normalizeCrudFormFields,
  createCrudFormModel,
  buildCrudFormPayload,
  applyCrudPayloadToForm,
  resolveCrudFieldErrors,
  parseCrudResourceOperationInput
} from "../src/client/composables/crudSchemaFormHelpers.js";

test("normalizeCrudFormFields trims keys, removes invalid entries, and deduplicates", () => {
  const fields = normalizeCrudFormFields([
    { key: " name ", type: "string" },
    { key: "name", type: "string" },
    { key: "", type: "string" },
    null,
    { key: "active", type: "boolean" }
  ]);

  assert.deepEqual(fields.map((field) => field.key), ["name", "active"]);
});

test("createCrudFormModel resolves defaults and supports explicit initial values", () => {
  const model = createCrudFormModel([
    { key: "name", type: "string" },
    { key: "active", type: "boolean" },
    { key: "role", type: "string", initialValue: "member" }
  ]);

  assert.deepEqual(model, {
    name: "",
    active: false,
    role: "member"
  });
});

test("buildCrudFormPayload normalizes booleans and numbers while skipping empty numeric values", () => {
  const payload = buildCrudFormPayload(
    [
      { key: "name", type: "string" },
      { key: "active", type: "boolean" },
      { key: "age", type: "integer" },
      { key: "score", type: "number" }
    ],
    {
      name: "Ada",
      active: 1,
      age: "42",
      score: ""
    }
  );

  assert.deepEqual(payload, {
    name: "Ada",
    active: true,
    age: 42
  });
});

test("applyCrudPayloadToForm maps payload values into reactive form model", () => {
  const form = reactive({
    name: "",
    active: false,
    age: ""
  });
  applyCrudPayloadToForm(
    [
      { key: "name", type: "string" },
      { key: "active", type: "boolean" },
      { key: "age", type: "integer" }
    ],
    form,
    {
      name: "Grace",
      active: 1,
      age: 33
    }
  );

  assert.deepEqual(form, {
    name: "Grace",
    active: true,
    age: "33"
  });
});

test("resolveCrudFieldErrors returns Vuetify-compatible error arrays", () => {
  assert.deepEqual(resolveCrudFieldErrors({ name: "Name is required." }, "name"), ["Name is required."]);
  assert.deepEqual(resolveCrudFieldErrors({ name: "Name is required." }, "email"), []);
});

test("parseCrudResourceOperationInput validates and normalizes operation body payloads", () => {
  const resource = {
    operations: {
      create: {
        bodyValidator: {
          schema: Type.Object(
            {
              name: Type.String({ minLength: 1 }),
              age: Type.Integer({ minimum: 1 })
            },
            { additionalProperties: false }
          ),
          normalize(payload = {}) {
            return {
              name: String(payload.name || "").trim(),
              age: Number(payload.age)
            };
          }
        }
      }
    }
  };

  const validResult = parseCrudResourceOperationInput({
    resource,
    operationName: "create",
    rawPayload: {
      name: "  Ada  ",
      age: "2"
    }
  });
  assert.equal(validResult.ok, true);
  assert.deepEqual(validResult.value, {
    name: "Ada",
    age: 2
  });

  const invalidResult = parseCrudResourceOperationInput({
    resource,
    operationName: "create",
    rawPayload: {
      name: "   ",
      age: "0"
    }
  });
  assert.equal(invalidResult.ok, false);
});
