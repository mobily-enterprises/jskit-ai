import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveCrudResourceScopeName } from "@jskit-ai/resource-crud-core/shared/crudLookup";

// Whether a value is a plain object: a json-rest-api payload, resource
// definition or option bag, not an array, class instance or null.
function isPlainJsonRestObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// The json-rest-api hasMany relationships a table resource's collection fields declare (`relation.kind:
// "collection"`), by relationship name: the host registers them, and a handle shapes the records they include.
function resolveJsonRestCollectionRelationships(resource) {
  const resourceSchema = normalizeObject(resource?.schema);
  const relationships = {};

  for (const [fieldName, fieldDefinition] of Object.entries(resourceSchema)) {
    const normalizedFieldDefinition = normalizeObject(fieldDefinition);
    const relation = normalizeObject(normalizedFieldDefinition.relation);
    if (normalizeText(relation.kind).toLowerCase() !== "collection") {
      continue;
    }

    const relationshipName = normalizeText(relation.as || normalizedFieldDefinition.as, {
      fallback: fieldName
    });
    const target = resolveCrudResourceScopeName(
      relation.target || relation.targetResource || relation.namespace || relation.apiPath
    );
    const foreignKey = normalizeText(relation.foreignKey);
    if (!relationshipName || !target || !foreignKey) {
      continue;
    }

    relationships[relationshipName] = {
      type: "hasMany",
      target,
      foreignKey
    };
  }

  return relationships;
}

export { isPlainJsonRestObject, resolveJsonRestCollectionRelationships };
