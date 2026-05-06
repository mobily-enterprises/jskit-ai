import { isRecord, normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

function resolveRelationshipFieldKey(relationshipName = "", lookupFieldMap = null) {
  const normalizedRelationshipName = normalizeText(relationshipName);
  const explicitFieldKey = normalizeText(lookupFieldMap?.[normalizedRelationshipName]);
  if (explicitFieldKey) {
    return explicitFieldKey;
  }

  return normalizedRelationshipName ? `${normalizedRelationshipName}Id` : "";
}

function simplifyJsonApiResourceWithRelationshipIds(resource = {}, { lookupFieldMap = null } = {}) {
  const normalizedResource = isRecord(resource) ? normalizeObject(resource) : {};
  const simplified = {
    id: normalizedResource.id == null ? "" : String(normalizedResource.id),
    ...(normalizeObject(normalizedResource.attributes))
  };

  for (const [relationshipName, relationshipValue] of Object.entries(normalizeObject(normalizedResource.relationships))) {
    const relationshipData = relationshipValue?.data;
    if (Array.isArray(relationshipData)) {
      continue;
    }

    const fieldKey = resolveRelationshipFieldKey(relationshipName, lookupFieldMap);
    if (!fieldKey || Object.hasOwn(simplified, fieldKey)) {
      continue;
    }
    simplified[fieldKey] = relationshipData?.id == null ? null : String(relationshipData.id);
  }

  return simplified;
}

export {
  resolveRelationshipFieldKey,
  simplifyJsonApiResourceWithRelationshipIds
};
