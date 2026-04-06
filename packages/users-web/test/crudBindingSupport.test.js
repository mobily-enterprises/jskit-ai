import assert from "node:assert/strict";
import test from "node:test";
import { ref } from "vue";
import {
  CRUD_BINDING_MODE_ROUTE,
  CRUD_BINDING_MODE_MERGE,
  CRUD_BINDING_MODE_EXPLICIT,
  CRUD_BINDING_MODE_NONE,
  normalizeCrudBindingMode,
  resolveCrudBoundValues
} from "../src/client/composables/crud/crudBindingSupport.js";

test("normalizeCrudBindingMode defaults invalid values to route", () => {
  assert.equal(normalizeCrudBindingMode(""), CRUD_BINDING_MODE_ROUTE);
  assert.equal(normalizeCrudBindingMode("unknown"), CRUD_BINDING_MODE_ROUTE);
  assert.equal(normalizeCrudBindingMode("merge"), CRUD_BINDING_MODE_MERGE);
  assert.equal(normalizeCrudBindingMode("explicit"), CRUD_BINDING_MODE_EXPLICIT);
  assert.equal(normalizeCrudBindingMode("none"), CRUD_BINDING_MODE_NONE);
});

test("resolveCrudBoundValues returns route values in route mode", () => {
  const values = resolveCrudBoundValues({
    binding: {
      mode: "route",
      values: {
        contactId: "22"
      }
    },
    routeValues: {
      contactId: "11"
    }
  });

  assert.deepEqual(values, {
    contactId: "11"
  });
});

test("resolveCrudBoundValues merges explicit values over route values in merge mode", () => {
  const values = resolveCrudBoundValues({
    binding: {
      mode: "merge",
      values: {
        contactId: "22",
        serviceId: "4"
      }
    },
    routeValues: {
      contactId: "11"
    }
  });

  assert.deepEqual(values, {
    contactId: "22",
    serviceId: "4"
  });
});

test("resolveCrudBoundValues uses only explicit values in explicit mode", () => {
  const values = resolveCrudBoundValues({
    binding: {
      mode: "explicit",
      values: {
        serviceId: "4"
      }
    },
    routeValues: {
      contactId: "11"
    }
  });

  assert.deepEqual(values, {
    serviceId: "4"
  });
});

test("resolveCrudBoundValues disables automatic binding in none mode", () => {
  const values = resolveCrudBoundValues({
    binding: {
      mode: "none",
      values: {
        serviceId: "4"
      }
    },
    routeValues: {
      contactId: "11"
    }
  });

  assert.deepEqual(values, {});
});

test("resolveCrudBoundValues unwraps reactive binding config and values", () => {
  const values = resolveCrudBoundValues({
    binding: ref({
      mode: "merge",
      values: ref({
        serviceId: "4"
      })
    }),
    routeValues: {
      contactId: "11"
    }
  });

  assert.deepEqual(values, {
    contactId: "11",
    serviceId: "4"
  });
});
