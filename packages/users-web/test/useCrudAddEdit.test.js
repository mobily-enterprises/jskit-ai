import assert from "node:assert/strict";
import test from "node:test";
import { reactive } from "vue";
import {
  normalizeCrudFormFields,
  createCrudFormModel,
  buildCrudFormPayload,
  applyCrudPayloadToForm,
  resolveCrudRouteBoundFieldValues,
  applyCrudRouteBoundFieldValues,
  resolveCrudFieldErrors
} from "../src/client/composables/crud/crudSchemaFormHelpers.js";

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
    { key: "reviewed", type: "boolean", nullable: true },
    { key: "role", type: "string", initialValue: "member" }
  ]);

  assert.deepEqual(model, {
    name: "",
    active: false,
    reviewed: null,
    role: "member"
  });
});

test("createCrudFormModel preserves explicit boolean defaults for nullable fields", () => {
  const model = createCrudFormModel([
    { key: "reviewed", type: "boolean", nullable: true, initialValue: false },
    { key: "approved", type: "boolean", nullable: true, defaultValue: true }
  ]);

  assert.deepEqual(model, {
    reviewed: false,
    approved: true
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

test("buildCrudFormPayload and applyCrudPayloadToForm round-trip date-time fields", () => {
  const fields = [
    { key: "scheduledAt", type: "string", format: "date-time" }
  ];
  const payload = buildCrudFormPayload(fields, {
    scheduledAt: "2024-01-02T03:04"
  });

  assert.match(payload.scheduledAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/);

  const form = reactive({
    scheduledAt: ""
  });
  applyCrudPayloadToForm(fields, form, payload);

  assert.equal(form.scheduledAt, "2024-01-02T03:04");
});

test("buildCrudFormPayload normalizes time fields to canonical HH:MM", () => {
  const fields = [
    { key: "fromTime", type: "string", format: "time" },
    { key: "toTime", type: "string", format: "time" }
  ];

  const payload = buildCrudFormPayload(fields, {
    fromTime: "06:13 PM",
    toTime: "18:45:00"
  });

  assert.deepEqual(payload, {
    fromTime: "18:13",
    toTime: "18:45"
  });
});

test("buildCrudFormPayload serializes cleared nullable typed fields as null", () => {
  const payload = buildCrudFormPayload(
    [
      { key: "reviewed", type: "boolean", nullable: true },
      { key: "serviceId", type: "integer", nullable: true },
      { key: "fromDate", type: "string", format: "date", nullable: true },
      { key: "scheduledAt", type: "string", format: "date-time", nullable: true },
      { key: "fromTime", type: "string", format: "time", nullable: true }
    ],
    {
      reviewed: null,
      serviceId: null,
      fromDate: "",
      scheduledAt: "",
      fromTime: ""
    }
  );

  assert.deepEqual(payload, {
    reviewed: null,
    serviceId: null,
    fromDate: null,
    scheduledAt: null,
    fromTime: null
  });
});

test("buildCrudFormPayload preserves nullable booleans while keeping non-nullable booleans binary", () => {
  const fields = [
    { key: "active", type: "boolean" },
    { key: "reviewed", type: "boolean", nullable: true },
    { key: "approved", type: "boolean", nullable: true }
  ];

  assert.deepEqual(
    buildCrudFormPayload(fields, {
      active: null,
      reviewed: null,
      approved: true
    }),
    {
      active: false,
      reviewed: null,
      approved: true
    }
  );

  assert.deepEqual(
    buildCrudFormPayload(fields, {
      active: 1,
      reviewed: 0,
      approved: false
    }),
    {
      active: true,
      reviewed: false,
      approved: false
    }
  );
});

test("applyCrudPayloadToForm normalizes time fields for form inputs", () => {
  const fields = [
    { key: "fromTime", type: "string", format: "time" },
    { key: "toTime", type: "string", format: "time" }
  ];
  const form = reactive({
    fromTime: "",
    toTime: ""
  });

  applyCrudPayloadToForm(fields, form, {
    fromTime: "18:13:00",
    toTime: "06:45 PM"
  });

  assert.deepEqual(form, {
    fromTime: "18:13",
    toTime: "18:45"
  });
});

test("applyCrudPayloadToForm maps payload values into reactive form model", () => {
  const form = reactive({
    name: "",
    active: false,
    reviewed: null,
    age: ""
  });
  applyCrudPayloadToForm(
    [
      { key: "name", type: "string" },
      { key: "active", type: "boolean" },
      { key: "reviewed", type: "boolean", nullable: true },
      { key: "age", type: "integer" }
    ],
    form,
    {
      name: "Grace",
      active: 1,
      reviewed: null,
      age: 33
    }
  );

  assert.deepEqual(form, {
    name: "Grace",
    active: true,
    reviewed: null,
    age: "33"
  });
});

test("applyCrudPayloadToForm preserves nullable boolean payload values", () => {
  const fields = [
    { key: "active", type: "boolean" },
    { key: "reviewed", type: "boolean", nullable: true },
    { key: "approved", type: "boolean", nullable: true }
  ];
  const form = reactive({
    active: false,
    reviewed: null,
    approved: null
  });

  applyCrudPayloadToForm(fields, form, {
    active: null,
    reviewed: null,
    approved: true
  });

  assert.deepEqual(form, {
    active: false,
    reviewed: null,
    approved: true
  });
});

test("resolveCrudRouteBoundFieldValues maps route params for route-bound form fields", () => {
  const values = resolveCrudRouteBoundFieldValues(
    [
      { key: "contactId", routeParamKey: "contactId" },
      { key: "name" }
    ],
    {
      contactId: " 2971 "
    }
  );

  assert.deepEqual(values, {
    contactId: "2971"
  });
});

test("applyCrudRouteBoundFieldValues enforces route-bound field values onto target payload", () => {
  const payload = {
    name: "Address one",
    contactId: "123"
  };
  applyCrudRouteBoundFieldValues(
    [
      { key: "contactId", routeParamKey: "contactId" }
    ],
    payload,
    {
      contactId: "2971"
    }
  );

  assert.deepEqual(payload, {
    name: "Address one",
    contactId: "2971"
  });
});

test("resolveCrudFieldErrors returns Vuetify-compatible error arrays", () => {
  assert.deepEqual(resolveCrudFieldErrors({ name: "Name is required." }, "name"), ["Name is required."]);
  assert.deepEqual(resolveCrudFieldErrors({ name: "Name is required." }, "email"), []);
});
