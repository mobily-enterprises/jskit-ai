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

const NOTHING_INCLUDED = Object.freeze({ attributes: Object.freeze([]), relationships: Object.freeze({}) });

/**
 * What a CRUD contract shows of a record it includes, beyond its id and label: its relation field's output entry's
 * `includeFields`, the included record's fields and, as `{ relationship: [...] }`, the records it links to with what
 * each of them shows, at any depth: `fields: { petId: { output: { required: false, includeFields: ["name", { breed:
 * ["name"] }] } } }`. Nothing else of an included record is shown.
 * @param {string} label Where the list is, such as "petId.includeFields".
 * @param {unknown} names
 * @returns {{ attributes: ReadonlyArray<string>, relationships: Readonly<Record<string, any>> }}
 */
function includeFieldsOf(label, names) {
  if (names === undefined) {
    return NOTHING_INCLUDED;
  }
  const attributes = [];
  const relationships = {};
  // A list that is not one is refused as its one malformed entry.
  for (const name of Array.isArray(names) ? names : [null]) {
    if (typeof name === "string" && normalizeText(name)) {
      attributes.push(normalizeText(name));
    } else if (isRecord(name) && Object.keys(name).length > 0 && Object.entries(name).every(([key, nested]) => normalizeText(key) && Array.isArray(nested))) {
      for (const [relationshipName, nested] of Object.entries(name)) {
        relationships[relationshipName] = includeFieldsOf(`${label}.${relationshipName}`, nested);
      }
    } else {
      throw new TypeError(
        `A CRUD contract's ${label} must list the fields an included record shows: field names, ` +
        "and { relationship: [...] } for a record it links to."
      );
    }
  }
  return Object.freeze({ attributes: Object.freeze(attributes), relationships: Object.freeze(relationships) });
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
        include: includeFieldsOf(`${fieldKey}.includeFields`, normalizedFieldDefinition.includeFields),
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
      include: includeFieldsOf(`${fieldKey}.includeFields`, normalizedFieldDefinition.includeFields),
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
