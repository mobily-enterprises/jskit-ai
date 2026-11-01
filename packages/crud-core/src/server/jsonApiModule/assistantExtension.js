import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { normalizeJsonApiFieldsets } from "@jskit-ai/kernel/shared/support/jsonApiFieldsets";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import {
  decodeJsonApiResourceResponse,
  normalizeJsonApiDocument,
  unwrapJsonApiResult
} from "@jskit-ai/http-runtime/shared";
import {
  resolveJsonApiFieldsetContract,
  resolveJsonApiRelationshipEntries,
  resolveSchemaFieldDefinitions
} from "../jsonApiResourceContract.js";
import { normalizeOptionalText } from "../normalizeOptionalText.js";

const CRUD_ASSISTANT_RESOURCE_OPERATION = Object.freeze({
  list: "list",
  view: "view",
  create: "create",
  update: "patch",
  delete: "delete"
});

function resolveAssistantResultValue(result) {
  const taggedResult = unwrapJsonApiResult(result);
  const value = taggedResult ? taggedResult.value : result;
  const document = normalizeJsonApiDocument(value);
  return {
    value,
    document
  };
}

function createProjectionRecordSchema(recordSchema, {
  lookupContainerKey = "",
  relationshipEntries = []
} = {}) {
  // readable-check: allow optional-call - data: a resource's output schema without field definitions passes through
  const definitions = recordSchema?.getFieldDefinitions?.();
  if (!isRecord(definitions)) {
    return recordSchema;
  }

  const fields = Object.fromEntries(
    Object.entries(definitions).map(([fieldKey, fieldDefinition]) => [
      fieldKey,
      {
        ...fieldDefinition,
        required: fieldKey === "id" && fieldDefinition?.required === true
      }
    ])
  );
  if (lookupContainerKey && isRecord(fields[lookupContainerKey])) {
    const createRelatedRecordSchema = (entry) => createSchema({
      id: {
        type: "string",
        required: true
      },
      ...(entry.labelKey && entry.labelKey !== "id"
        ? {
            [entry.labelKey]: {
              type: "string",
              required: false,
              nullable: true
            }
          }
        : {})
    });
    const lookupFields = Object.fromEntries(
      relationshipEntries.map((entry) => [
        entry.relationshipName,
        entry.many === true
          ? {
              type: "array",
              required: false,
              items: {
                type: "object",
                schema: createRelatedRecordSchema(entry),
                additionalProperties: true
              }
            }
          : {
              type: "object",
              required: false,
              schema: createRelatedRecordSchema(entry),
              additionalProperties: true
            }
      ])
    );
    fields[lookupContainerKey] = {
      ...fields[lookupContainerKey],
      type: "object",
      required: false,
      ...(Object.keys(lookupFields).length > 0 ? { schema: createSchema(lookupFields) } : {}),
      additionalProperties: true
    };
  }

  return createSchema(fields);
}

function createProjectionOutputDefinition(output, operation, relationshipEntries, lookupContainerKey) {
  if (!output || (operation !== "list" && operation !== "view")) {
    return output;
  }

  if (operation === "view") {
    return Object.freeze({
      schema: createProjectionRecordSchema(output.schema, { lookupContainerKey, relationshipEntries }),
      mode: "replace"
    });
  }

  const listFields = resolveSchemaFieldDefinitions(output);
  const items = listFields.items;
  // readable-check: allow method-probe - data: a resource's output schema without field definitions passes through
  if (!isRecord(items) || items.type !== "array" || typeof items.items?.getFieldDefinitions !== "function") {
    return output;
  }

  return Object.freeze({
    schema: createSchema({
      ...listFields,
      items: {
        ...items,
        items: createProjectionRecordSchema(items.items, { lookupContainerKey, relationshipEntries })
      }
    }),
    mode: "replace"
  });
}

function createCrudAssistantTransport(resource, operation, relationshipEntries, lookupContainerKey) {
  const lookupFieldMap = Object.fromEntries(
    relationshipEntries
      .filter((entry) => entry.many !== true)
      .map((entry) => [entry.relationshipName, entry.attributeKey])
  );
  return Object.freeze({
    kind: "jsonapi-resource",
    responseType: resource.namespace,
    responseKind: operation === "list" ? "collection" : "record",
    ...(lookupContainerKey ? { lookupContainerKey } : {}),
    ...(Object.keys(lookupFieldMap).length > 0 ? { lookupFieldMap } : {})
  });
}

function projectCrudAssistantRecordFields(record, selectedFields = null, {
  preserveKeys = []
} = {}) {
  if (!isRecord(record) || !Array.isArray(selectedFields)) {
    return record;
  }

  const allowedKeys = new Set(["id", ...preserveKeys, ...selectedFields]);
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => allowedKeys.has(key))
  );
}

function projectCrudAssistantLookupValue(value, selectedFields = null) {
  if (Array.isArray(value)) {
    return value.map((entry) => projectCrudAssistantRecordFields(entry, selectedFields));
  }
  return projectCrudAssistantRecordFields(value, selectedFields);
}

function projectCrudAssistantReadRecord(record, {
  lookupContainerKey = "",
  primaryFields = null,
  relatedFieldsByLookupKey = new Map()
} = {}) {
  if (!isRecord(record)) {
    return record;
  }

  const primaryProjection = projectCrudAssistantRecordFields(record, primaryFields, {
    preserveKeys: lookupContainerKey && isRecord(record[lookupContainerKey])
      ? [lookupContainerKey]
      : []
  });
  const projectedRecord = primaryProjection === record ? { ...record } : primaryProjection;
  if (!lookupContainerKey || !isRecord(projectedRecord[lookupContainerKey])) {
    return projectedRecord;
  }

  projectedRecord[lookupContainerKey] = Object.fromEntries(
    Object.entries(projectedRecord[lookupContainerKey]).map(([lookupKey, value]) => {
      return [
        lookupKey,
        projectCrudAssistantLookupValue(value, relatedFieldsByLookupKey.get(lookupKey))
      ];
    })
  );
  return projectedRecord;
}

function createCrudAssistantResultProjection(input, resource = {}, relationshipEntries = []) {
  const primaryType = String(resource?.namespace || "").trim();
  const fieldsets = normalizeJsonApiFieldsets(input.fields, {
    primaryType
  });
  if (Object.keys(fieldsets).length < 1) {
    return null;
  }

  const relatedFieldsByLookupKey = new Map();
  for (const entry of relationshipEntries) {
    const selectedFields = fieldsets[entry.relationshipType];
    if (!Array.isArray(selectedFields)) {
      continue;
    }
    relatedFieldsByLookupKey.set(entry.relationshipName, selectedFields);
    relatedFieldsByLookupKey.set(entry.attributeKey, selectedFields);
  }

  return {
    primaryFields: fieldsets[primaryType],
    relatedFieldsByLookupKey
  };
}

function projectCrudAssistantReadResult(result, projection = null, {
  lookupContainerKey = ""
} = {}) {
  if (!projection) {
    return result;
  }

  const projectionOptions = {
    ...projection,
    lookupContainerKey
  };
  if (isRecord(result) && Array.isArray(result.items)) {
    return {
      ...result,
      items: result.items.map((entry) => projectCrudAssistantReadRecord(entry, projectionOptions))
    };
  }

  return projectCrudAssistantReadRecord(result, projectionOptions);
}

function transformCrudAssistantResult(operation, result, {
  input = {},
  resource,
  relationshipEntries = [],
  lookupContainerKey = ""
} = {}) {
  if (operation === "delete") {
    const resolved = resolveAssistantResultValue(result);
    if (isRecord(resolved.value) && resolved.value.deleted === true && resolved.value.id != null) {
      return resolved.value;
    }
    return {
      id: String(input.recordId || ""),
      deleted: true
    };
  }

  const resolved = resolveAssistantResultValue(result);
  const projection = operation === "list" || operation === "view"
    ? createCrudAssistantResultProjection(input, resource, relationshipEntries)
    : null;
  const projectReadResult = (value) => projectCrudAssistantReadResult(value, projection, {
    lookupContainerKey
  });
  if (operation === "list") {
    if (resolved.document.kind === "collection") {
      const decoded = decodeJsonApiResourceResponse(
        resolved.value,
        createCrudAssistantTransport(resource, operation, relationshipEntries, lookupContainerKey)
      );
      return projectReadResult({
        items: decoded.items,
        nextCursor: normalizeOptionalText(decoded.nextCursor)
      });
    }
    if (Array.isArray(resolved.value)) {
      return projectReadResult({
        items: resolved.value,
        nextCursor: null
      });
    }
    if (isRecord(resolved.value) && Array.isArray(resolved.value.items)) {
      return projectReadResult({
        items: resolved.value.items,
        nextCursor: normalizeOptionalText(resolved.value.nextCursor)
      });
    }
    return resolved.value;
  }

  if (resolved.document.kind === "resource") {
    return projectReadResult(decodeJsonApiResourceResponse(
      resolved.value,
      createCrudAssistantTransport(resource, operation, relationshipEntries, lookupContainerKey)
    ));
  }
  return projectReadResult(resolved.value);
}

function createCrudAssistantReadDescription({
  fieldsetContract,
  lookupContainerKey = "",
  namespace = "",
  operation = "list"
} = {}) {
  const relationshipEntries = fieldsetContract.relationshipEntries;
  const firstRelationship = relationshipEntries[0] || null;
  const includeExample = relationshipEntries.length > 0
    ? relationshipEntries.slice(0, 2).map((entry) => entry.relationshipName).join(",")
    : "pet,service";
  const fieldsExample = firstRelationship
    ? ` fields can be {\"${namespace}\":[\"${firstRelationship.attributeKey}\"],` +
      `\"${firstRelationship.relationshipType}\":[\"${firstRelationship.labelKey || "id"}\"]}.`
    : ` fields can be {\"${namespace}\":[\"id\"]}.`;
  const aliasGuidance = fieldsetContract.aliasMappings
    .map((entry) => `use \"${entry.resourceType}\" instead of \"${entry.alias}\"`)
    .join("; ");
  const fieldsetKeyGuidance = fieldsetContract.resourceTypes.length > 0
    ? ` fields keys must be JSON:API resource types: ${fieldsetContract.resourceTypes.map((entry) => `\"${entry}\"`).join(", ")}.` +
      (aliasGuidance ? ` Relationship aliases are invalid fieldset keys; ${aliasGuidance}.` : "")
    : "";
  const primaryFieldGuidance = fieldsetContract.primaryFields.length > 0
    ? ` Valid \"${namespace}\" fields: ${fieldsetContract.primaryFields.map((entry) => `\"${entry}\"`).join(", ")}.`
    : "";
  const relationshipGuidance = relationshipEntries.length > 0
    ? ` Include relationships: ${relationshipEntries.map((entry) => {
        const lookupPath = lookupContainerKey
          ? ` -> ${operation === "list" ? "items[]." : ""}${lookupContainerKey}.${entry.relationshipName}`
          : "";
        return `\"${entry.relationshipName}\" -> resource type \"${entry.relationshipType}\"${lookupPath}`;
      }).join("; ")}.`
    : "";

  const subject = operation === "list" ? `List ${namespace} records.` : `View a ${namespace} record.`;
  return `${subject} include must be a comma-separated string such as \"${includeExample}\";` +
    `${fieldsExample}${fieldsetKeyGuidance}${primaryFieldGuidance}${relationshipGuidance}`;
}

function createCrudAssistantExtension(resource, namespace, operation) {
  const resourceOperation = CRUD_ASSISTANT_RESOURCE_OPERATION[operation];
  const nativeOutput = resource?.operations?.[resourceOperation]?.output || null;
  const recordOutput = operation === "list"
    ? Object.freeze({
        schema: resolveSchemaFieldDefinitions(nativeOutput).items?.items,
        mode: "replace"
      })
    : nativeOutput;
  const relationshipEntries = resolveJsonApiRelationshipEntries(recordOutput);
  const lookupContainerKey = String(resource?.contract?.lookup?.containerKey || "").trim();
  const output = createProjectionOutputDefinition(
    nativeOutput,
    operation,
    relationshipEntries,
    lookupContainerKey
  );
  const actionLabel = operation === "list" || operation === "view"
    ? createCrudAssistantReadDescription({
        fieldsetContract: resolveJsonApiFieldsetContract(resource),
        lookupContainerKey,
        namespace,
        operation
      })
    : operation === "create"
      ? `Create a ${namespace} record.`
      : operation === "update"
        ? `Update a ${namespace} record.`
        : `Delete a ${namespace} record.`;

  function transformResult(result, context) {
    return transformCrudAssistantResult(operation, result, {
      ...context,
      resource,
      relationshipEntries,
      lookupContainerKey
    });
  }

  return Object.freeze({ description: actionLabel, output, transformResult });
}

export {
  createCrudAssistantExtension
};
