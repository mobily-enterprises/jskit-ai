import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

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

function inferCrudJsonApiTransport(resource = null, { mode = "", operationName = "" } = {}) {
  const resourceType = resolveCrudJsonApiResourceType(resource);
  if (!resourceType) {
    return null;
  }

  const normalizedMode = normalizeText(mode).toLowerCase();
  const normalizedOperationName = normalizeText(operationName).toLowerCase();
  if (normalizedMode === "list") {
    return Object.freeze({
      kind: "jsonapi-resource",
      responseType: resourceType,
      responseKind: "collection"
    });
  }

  if (normalizedMode === "view") {
    return Object.freeze({
      kind: "jsonapi-resource",
      responseType: resourceType,
      responseKind: "record"
    });
  }

  if (normalizedMode === "add-edit") {
    return Object.freeze({
      kind: "jsonapi-resource",
      ...(normalizedOperationName ? { requestType: resourceType } : {}),
      responseType: resourceType,
      responseKind: "record"
    });
  }

  return null;
}

function resolveCrudJsonApiTransport(transport = null, resource = null, options = {}) {
  if (transport != null) {
    throw new TypeError(
      "CRUD hooks no longer accept explicit transport. Derive JSON:API transport from the shared resource instead."
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
  if (Object.keys(lookupFieldMap).length < 1 && !lookupContainerKey) {
    return baseTransport;
  }

  return Object.freeze({
    ...baseTransport,
    ...(Object.keys(lookupFieldMap).length > 0 ? { lookupFieldMap } : {}),
    ...(lookupContainerKey ? { lookupContainerKey } : {})
  });
}

export {
  inferCrudJsonApiTransport,
  resolveCrudJsonApiTransport,
  resolveLookupFieldMap
};
