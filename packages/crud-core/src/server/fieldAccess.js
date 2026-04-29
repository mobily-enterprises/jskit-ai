import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/validators/inputNormalization";

function isSchemaNullable(schema = {}) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return false;
  }

  const schemaType = schema.type;
  if (typeof schemaType === "string" && normalizeText(schemaType).toLowerCase() === "null") {
    return true;
  }
  if (Array.isArray(schemaType)) {
    const hasNullType = schemaType.some((entry) => normalizeText(entry).toLowerCase() === "null");
    if (hasNullType) {
      return true;
    }
  }

  const variants = [];
  if (Array.isArray(schema.anyOf)) {
    variants.push(...schema.anyOf);
  }
  if (Array.isArray(schema.oneOf)) {
    variants.push(...schema.oneOf);
  }

  return variants.some((entry) => isSchemaNullable(entry));
}

function normalizeFieldSet(value, { context = "crudFieldAccess", label = "field list" } = {}) {
  if (value == null || value === "*") {
    return null;
  }

  const rawValues = value instanceof Set
    ? [...value]
    : Array.isArray(value)
      ? value
      : null;
  if (!rawValues) {
    throw new TypeError(`${context} ${label} must be an array, set, or "*".`);
  }

  const normalizedKeys = rawValues
    .map((entry) => normalizeText(entry))
    .filter(Boolean);

  return new Set(normalizedKeys);
}

async function resolveFieldSet(resolver, input = {}, { context = "crudFieldAccess", label = "field list" } = {}) {
  const resolvedResolver = resolver;
  if (resolvedResolver == null) {
    return null;
  }

  const resolvedValue = typeof resolvedResolver === "function"
    ? await resolvedResolver(input)
    : resolvedResolver;

  return normalizeFieldSet(resolvedValue, { context, label });
}

function resolveWriteMode(fieldAccess = {}, { context = "crudFieldAccess" } = {}) {
  const writeMode = normalizeText(fieldAccess?.writeMode || "throw").toLowerCase();
  if (writeMode === "throw" || writeMode === "strip") {
    return writeMode;
  }

  throw new TypeError(`${context} fieldAccess.writeMode must be "throw" or "strip".`);
}

function buildOutputFieldRules(resource = {}) {
  const viewOutputSchema = resource?.operations?.view?.output?.schema;
  if (!viewOutputSchema || typeof viewOutputSchema !== "object" || Array.isArray(viewOutputSchema)) {
    return null;
  }

  const outputProperties = normalizeObject(viewOutputSchema.properties);
  const requiredFields = new Set(
    (Array.isArray(viewOutputSchema.required) ? viewOutputSchema.required : [])
      .map((entry) => normalizeText(entry))
      .filter(Boolean)
  );
  const fieldRules = new Map();

  for (const [fieldKey, fieldSchemaRaw] of Object.entries(outputProperties)) {
    const normalizedFieldKey = normalizeText(fieldKey);
    if (!normalizedFieldKey) {
      continue;
    }

    const fieldSchema = normalizeObject(fieldSchemaRaw);
    fieldRules.set(
      normalizedFieldKey,
      Object.freeze({
        required: requiredFields.has(normalizedFieldKey),
        nullable: isSchemaNullable(fieldSchema),
        hasDefault: Object.hasOwn(fieldSchema, "default"),
        defaultValue: fieldSchema.default
      })
    );
  }

  return Object.freeze({
    fieldRules: new Map(fieldRules)
  });
}

function resolveRoleFromFieldAccessInput(input = {}) {
  const role = normalizeText(input?.context?.auth?.role).toLowerCase();
  return role || "default";
}

function resolveActionFromFieldAccessInput(input = {}) {
  const action = normalizeText(input?.action).toLowerCase();
  return action || "*";
}

function resolveOperationPolicyValue(operationPolicy, input = {}, action = "*") {
  if (typeof operationPolicy === "function") {
    return operationPolicy(input);
  }
  if (
    operationPolicy == null ||
    operationPolicy === "*" ||
    Array.isArray(operationPolicy) ||
    operationPolicy instanceof Set
  ) {
    return operationPolicy;
  }
  if (typeof operationPolicy !== "object" || Array.isArray(operationPolicy)) {
    return null;
  }

  if (Object.hasOwn(operationPolicy, action)) {
    return operationPolicy[action];
  }
  if (Object.hasOwn(operationPolicy, "*")) {
    return operationPolicy["*"];
  }
  if (Object.hasOwn(operationPolicy, "all")) {
    return operationPolicy.all;
  }
  return null;
}

function resolveRoleMatrixPolicy(matrix = {}, operation = "readable", input = {}) {
  const sourceMatrix = normalizeObject(matrix);
  const role = resolveRoleFromFieldAccessInput(input);
  const action = resolveActionFromFieldAccessInput(input);

  const rolePolicy = normalizeObject(sourceMatrix[role]);
  const roleValue = resolveOperationPolicyValue(rolePolicy[operation], input, action);
  if (roleValue != null) {
    return roleValue;
  }

  const defaultPolicy = normalizeObject(sourceMatrix.default);
  return resolveOperationPolicyValue(defaultPolicy[operation], input, action);
}

function createFieldAccessForRoleMatrix(matrix = {}, { context = "crudFieldAccess" } = {}) {
  const sourceMatrix = normalizeObject(matrix);
  const writeMode = resolveWriteMode(
    { writeMode: sourceMatrix.writeMode },
    { context: `${context} createFieldAccessForRoleMatrix` }
  );

  return Object.freeze({
    readable(input = {}) {
      return resolveRoleMatrixPolicy(sourceMatrix, "readable", input);
    },
    writable(input = {}) {
      return resolveRoleMatrixPolicy(sourceMatrix, "writable", input);
    },
    writeMode
  });
}

function applyReadableFieldPolicyToRecord(record, allowedFields, outputRules = null, { context = "crudFieldAccess" } = {}) {
  if (!record || typeof record !== "object" || Array.isArray(record) || !allowedFields) {
    return record;
  }

  const nextRecord = { ...record };
  const fieldRules = outputRules?.fieldRules instanceof Map ? outputRules.fieldRules : null;

  for (const fieldKey of Object.keys(nextRecord)) {
    if (allowedFields.has(fieldKey)) {
      continue;
    }

    const fieldRule = fieldRules?.get(fieldKey);
    if (!fieldRule || fieldRule.required !== true) {
      delete nextRecord[fieldKey];
      continue;
    }

    if (fieldRule.nullable) {
      nextRecord[fieldKey] = null;
      continue;
    }

    if (fieldRule.hasDefault) {
      nextRecord[fieldKey] = fieldRule.defaultValue;
      continue;
    }

    throw new Error(
      `${context} cannot redact required non-nullable field "${fieldKey}" without schema.default.`
    );
  }

  return nextRecord;
}

function createCrudFieldAccessRuntime(resource = {}, { context = "crudFieldAccess" } = {}) {
  const outputRules = buildOutputFieldRules(resource);

  async function resolveReadableAllowedFields(fieldAccess = {}, input = {}) {
    const allowedFields = await resolveFieldSet(
      fieldAccess?.readable,
      input,
      {
        context,
        label: "fieldAccess.readable"
      }
    );
    if (!allowedFields) {
      return null;
    }
    if (!outputRules) {
      throw new TypeError(`${context} requires resource.operations.view.output.schema for fieldAccess.readable.`);
    }

    return allowedFields;
  }

  async function enforceWritablePayload(payload = {}, fieldAccess = {}, input = {}) {
    const allowedFields = await resolveFieldSet(
      fieldAccess?.writable,
      input,
      {
        context,
        label: "fieldAccess.writable"
      }
    );
    if (!allowedFields) {
      return payload;
    }
    const sourcePayload = normalizeObjectInput(payload);

    const writeMode = resolveWriteMode(fieldAccess, { context });
    const filteredPayload = {};
    const forbiddenFields = [];
    for (const [fieldKey, fieldValue] of Object.entries(sourcePayload)) {
      if (allowedFields.has(fieldKey)) {
        filteredPayload[fieldKey] = fieldValue;
      } else {
        forbiddenFields.push(fieldKey);
      }
    }

    if (forbiddenFields.length > 0 && writeMode === "throw") {
      throw new AppError(403, `Write access denied for fields: ${forbiddenFields.join(", ")}.`);
    }

    return filteredPayload;
  }

  async function filterReadableRecord(record = null, fieldAccess = {}, input = {}) {
    const allowedFields = await resolveReadableAllowedFields(fieldAccess, input);
    if (!allowedFields) {
      return record;
    }

    return applyReadableFieldPolicyToRecord(record, allowedFields, outputRules, {
      context
    });
  }

  async function filterReadableListResult(listResult = {}, fieldAccess = {}, input = {}) {
    const allowedFields = await resolveReadableAllowedFields(fieldAccess, input);
    if (!allowedFields) {
      return listResult;
    }

    const sourceList = normalizeObject(listResult);
    const sourceItems = Array.isArray(sourceList.items) ? sourceList.items : [];
    if (sourceItems.length < 1) {
      return sourceList;
    }
    const filteredItems = sourceItems.map((record) =>
      applyReadableFieldPolicyToRecord(record, allowedFields, outputRules, {
        context
      })
    );

    return {
      ...sourceList,
      items: filteredItems
    };
  }

  return Object.freeze({
    enforceWritablePayload,
    filterReadableRecord,
    filterReadableListResult
  });
}

export { createCrudFieldAccessRuntime };
export { createFieldAccessForRoleMatrix };
