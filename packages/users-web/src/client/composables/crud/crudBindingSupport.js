import { unref } from "vue";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { asPlainObject } from "../support/scopeHelpers.js";

const CRUD_BINDING_MODE_ROUTE = "route";
const CRUD_BINDING_MODE_MERGE = "merge";
const CRUD_BINDING_MODE_EXPLICIT = "explicit";
const CRUD_BINDING_MODE_NONE = "none";

function normalizeCrudBindingMode(value = "") {
  const normalizedValue = normalizeText(value).toLowerCase();
  if (normalizedValue === CRUD_BINDING_MODE_MERGE) {
    return CRUD_BINDING_MODE_MERGE;
  }
  if (normalizedValue === CRUD_BINDING_MODE_EXPLICIT) {
    return CRUD_BINDING_MODE_EXPLICIT;
  }
  if (normalizedValue === CRUD_BINDING_MODE_NONE) {
    return CRUD_BINDING_MODE_NONE;
  }

  return CRUD_BINDING_MODE_ROUTE;
}

function normalizeCrudBindingConfig(binding = {}) {
  const source = asPlainObject(unref(binding));
  return Object.freeze({
    mode: normalizeCrudBindingMode(source.mode),
    values: source.values ?? null
  });
}

function resolveCrudBindingValues(values, context = {}) {
  if (typeof values === "function") {
    return asPlainObject(values(context));
  }

  return asPlainObject(unref(values));
}

function resolveCrudBoundValues({
  binding = {},
  routeValues = {},
  context = {}
} = {}) {
  const normalizedBinding = normalizeCrudBindingConfig(binding);
  const normalizedRouteValues = asPlainObject(routeValues);
  const explicitValues = resolveCrudBindingValues(normalizedBinding.values, context);

  if (normalizedBinding.mode === CRUD_BINDING_MODE_NONE) {
    return {};
  }
  if (normalizedBinding.mode === CRUD_BINDING_MODE_EXPLICIT) {
    return explicitValues;
  }
  if (normalizedBinding.mode === CRUD_BINDING_MODE_MERGE) {
    return {
      ...normalizedRouteValues,
      ...explicitValues
    };
  }

  return normalizedRouteValues;
}

export {
  CRUD_BINDING_MODE_ROUTE,
  CRUD_BINDING_MODE_MERGE,
  CRUD_BINDING_MODE_EXPLICIT,
  CRUD_BINDING_MODE_NONE,
  normalizeCrudBindingMode,
  normalizeCrudBindingConfig,
  resolveCrudBindingValues,
  resolveCrudBoundValues
};
