import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveCrudResourceScopeName } from "@jskit-ai/resource-crud-core/shared/crudLookup";

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

function resolveJsonApiRelationshipEntries(definition = null) {
  const entries = [];

  for (const [fieldKey, fieldDefinition] of Object.entries(resolveSchemaFieldDefinitions(definition))) {
    const normalizedFieldDefinition = isRecord(fieldDefinition) ? fieldDefinition : {};
    const relationshipType = String(normalizedFieldDefinition.belongsTo || "").trim();
    if (relationshipType) {
      const relationshipName = String(normalizedFieldDefinition.as || fieldKey || "").trim();
      if (!relationshipName) {
        continue;
      }

      entries.push(Object.freeze({
        attributeKey: fieldKey,
        relationshipName,
        relationshipType,
        labelKey: String(normalizedFieldDefinition?.relation?.labelKey || "").trim(),
        required: normalizedFieldDefinition.required === true,
        nullable: normalizedFieldDefinition.nullable === true
      }));
      continue;
    }

    const relation = isRecord(normalizedFieldDefinition.relation)
      ? normalizedFieldDefinition.relation
      : {};
    if (String(relation.kind || "").trim().toLowerCase() !== "collection") {
      continue;
    }

    const collectionRelationshipType = resolveCrudResourceScopeName(
      relation.target || relation.targetResource || relation.namespace || relation.apiPath
    );
    if (!collectionRelationshipType) {
      continue;
    }

    const collectionRelationshipName = String(
      relation.as || normalizedFieldDefinition.as || fieldKey || ""
    ).trim();
    if (!collectionRelationshipName) {
      continue;
    }

    entries.push(Object.freeze({
      attributeKey: fieldKey,
      relationshipName: collectionRelationshipName,
      relationshipType: collectionRelationshipType,
      labelKey: String(relation.labelKey || "").trim(),
      many: true,
      required: normalizedFieldDefinition.required === true,
      nullable: normalizedFieldDefinition.nullable === true
    }));
  }

  return Object.freeze(entries);
}

function resolveJsonApiFieldsetContract(resource = {}) {
  const primaryType = normalizeText(resource?.namespace);
  const relationshipEntries = resolveJsonApiRelationshipEntries(resource?.operations?.view?.output);
  const lookupContainerKey = normalizeText(resource?.contract?.lookup?.containerKey);
  const primaryFields = Object.freeze(
    Object.keys(resolveSchemaFieldDefinitions(resource?.operations?.view?.output))
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
  resolveJsonApiFieldsetContract,
  resolveJsonApiRelationshipEntries,
  resolveSchemaFieldDefinitions
};
