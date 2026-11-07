import { isRecord, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveCrudResourceScopeName } from "@jskit-ai/resource-crud-core/shared/crudLookup";

function resolveSchemaFieldDefinitions(definition = null) {
  const schema = definition?.schema;
  // readable-check: allow method-probe - data: a resource schema without field definitions has none
  if (!schema || typeof schema.getFieldDefinitions !== "function") {
    return {};
  }

  const definitions = schema.getFieldDefinitions();
  return isRecord(definitions) ? definitions : {};
}

function resolveJsonApiRelationshipEntries(definition = null) {
  const entries = [];

  for (const [fieldKey, fieldDefinition] of Object.entries(resolveSchemaFieldDefinitions(definition))) {
    const normalizedFieldDefinition = isRecord(fieldDefinition) ? fieldDefinition : {};
    const relationshipType = normalizeText(normalizedFieldDefinition.belongsTo);
    if (relationshipType) {
      const relationshipName = normalizeText(normalizedFieldDefinition.as || fieldKey);
      if (!relationshipName) {
        continue;
      }

      entries.push(Object.freeze({
        attributeKey: fieldKey,
        relationshipName,
        relationshipType,
        labelKey: normalizeText(normalizedFieldDefinition.relation?.labelKey),
        lookupNamespace: normalizeText(normalizedFieldDefinition.relation?.kind).toLowerCase() === "lookup"
          ? normalizeText(normalizedFieldDefinition.relation?.namespace)
          : "",
        required: normalizedFieldDefinition.required === true,
        nullable: normalizedFieldDefinition.nullable === true
      }));
      continue;
    }

    const relation = isRecord(normalizedFieldDefinition.relation)
      ? normalizedFieldDefinition.relation
      : {};
    if (normalizeText(relation.kind).toLowerCase() !== "collection") {
      continue;
    }

    const collectionRelationshipType = resolveCrudResourceScopeName(
      relation.target || relation.targetResource || relation.namespace || relation.apiPath
    );
    if (!collectionRelationshipType) {
      continue;
    }

    const collectionRelationshipName = normalizeText(relation.as || normalizedFieldDefinition.as || fieldKey);
    if (!collectionRelationshipName) {
      continue;
    }

    entries.push(Object.freeze({
      attributeKey: fieldKey,
      relationshipName: collectionRelationshipName,
      relationshipType: collectionRelationshipType,
      labelKey: normalizeText(relation.labelKey),
      many: true,
      required: normalizedFieldDefinition.required === true,
      nullable: normalizedFieldDefinition.nullable === true
    }));
  }

  return Object.freeze(entries);
}

/**
 * The lookup container key a resource's contract declares, or "" when it declares none.
 * @param {import("./types.js").CrudContract} resource
 */
function resolveDeclaredLookupContainerKey(resource) {
  return normalizeText(resource.contract?.lookup?.containerKey);
}

function resolveJsonApiFieldsetContract(resource) {
  const primaryType = normalizeText(resource.namespace);
  const relationshipEntries = resolveJsonApiRelationshipEntries(resource.operations?.view?.output);
  const lookupContainerKey = resolveDeclaredLookupContainerKey(resource);
  const primaryFields = Object.freeze(
    Object.keys(resolveSchemaFieldDefinitions(resource.operations?.view?.output))
      .map((entry) => normalizeText(entry))
      .filter((entry) => entry && entry !== lookupContainerKey)
  );
  const aliasMappings = Object.freeze(
    relationshipEntries
      .filter((entry) => entry.relationshipName !== entry.relationshipType)
      .map((entry) => Object.freeze({
        alias: entry.relationshipName,
        resourceType: entry.relationshipType
      }))
  );
  const resourceTypes = [];
  const seenTypes = new Set();
  for (const resourceType of [
    primaryType,
    ...relationshipEntries.map((entry) => normalizeText(entry.relationshipType))
  ]) {
    if (!resourceType || seenTypes.has(resourceType)) {
      continue;
    }
    seenTypes.add(resourceType);
    resourceTypes.push(resourceType);
  }

  return Object.freeze({
    aliasMappings,
    primaryType,
    primaryFields,
    relationshipEntries,
    resourceTypes: Object.freeze(resourceTypes)
  });
}

export {
  resolveDeclaredLookupContainerKey,
  resolveJsonApiFieldsetContract,
  resolveJsonApiRelationshipEntries,
  resolveSchemaFieldDefinitions
};
