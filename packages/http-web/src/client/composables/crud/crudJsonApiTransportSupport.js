import { isRecord, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeCrudLookupNamespace } from "@jskit-ai/resource-crud-core/shared/crudLookup";

const CRUD_RESPONSE_KIND_BY_MODE = Object.freeze({
  list: "collection",
  view: "record",
  delete: "record",
  "add-edit": "record"
});

function resolveSchemaFieldDefinitions(definition = null) {
  const schema = definition?.schema;
  if (!schema || typeof schema.getFieldDefinitions !== "function") {
    return {};
  }

  const definitions = schema.getFieldDefinitions();
  return isRecord(definitions) ? definitions : {};
}

function resolveLookupFieldMap(resource = null) {
  const outputDefinition =
    resource?.operations?.view?.output ||
    resource?.operations?.create?.output ||
    resource?.operations?.patch?.output ||
    null;
  const mapping = {};

  for (const [fieldKey, fieldDefinition] of Object.entries(resolveSchemaFieldDefinitions(outputDefinition))) {
    const normalizedFieldDefinition = isRecord(fieldDefinition) ? fieldDefinition : {};
    if (!normalizeText(normalizedFieldDefinition.belongsTo)) {
      continue;
    }

    const relationshipName = normalizeText(normalizedFieldDefinition.as, {
      fallback: fieldKey
    });
    const normalizedFieldKey = normalizeText(fieldKey);
    if (!normalizedFieldKey || !relationshipName) {
      continue;
    }

    mapping[relationshipName] = normalizedFieldKey;
  }

  return Object.freeze(mapping);
}

function isJsonApiResourceTransport(transport = null) {
  return normalizeText(transport?.kind).toLowerCase() === "jsonapi-resource";
}

function resolveCrudJsonApiResourceType(resource = null) {
  return normalizeText(resource?.namespace);
}

function inferCrudLookupJsonApiTransport({ namespace = "", apiPath = "" } = {}) {
  const resourceType =
    normalizeCrudLookupNamespace(namespace) ||
    normalizeCrudLookupNamespace(apiPath);
  if (!resourceType) {
    return null;
  }

  return Object.freeze({
    kind: "jsonapi-resource",
    responseType: resourceType,
    responseKind: "collection"
  });
}

function inferCrudJsonApiTransport(resource = null, { mode = "", operationName = "" } = {}) {
  const resourceType = resolveCrudJsonApiResourceType(resource);
  if (!resourceType) {
    return null;
  }

  const normalizedMode = normalizeText(mode).toLowerCase();
  const responseKind = Object.hasOwn(CRUD_RESPONSE_KIND_BY_MODE, normalizedMode)
    ? CRUD_RESPONSE_KIND_BY_MODE[normalizedMode]
    : "";
  if (!responseKind) {
    return null;
  }

  const hasRequestType = normalizedMode === "add-edit" && Boolean(normalizeText(operationName));
  return Object.freeze({
    kind: "jsonapi-resource",
    ...(hasRequestType ? { requestType: resourceType } : {}),
    responseType: resourceType,
    responseKind
  });
}

function resolveCrudJsonApiTransport(transport = null, resource = null, options = {}) {
  if (transport != null) {
    throw new TypeError(
      "CRUD hooks do not accept explicit transport. Derive JSON:API transport from the shared resource."
    );
  }

  const baseTransport = inferCrudJsonApiTransport(resource, options);
  if (!isJsonApiResourceTransport(baseTransport)) {
    return baseTransport;
  }

  const lookupFieldMap = resolveLookupFieldMap(resource);
  const lookupContainerKey = normalizeText(resource?.contract?.lookup?.containerKey, {
    fallback: "lookups"
  });
  return Object.freeze({
    ...baseTransport,
    ...(Object.keys(lookupFieldMap).length > 0 ? { lookupFieldMap } : {}),
    lookupContainerKey
  });
}

export {
  inferCrudJsonApiTransport,
  inferCrudLookupJsonApiTransport,
  resolveCrudJsonApiTransport,
  resolveLookupFieldMap
};
