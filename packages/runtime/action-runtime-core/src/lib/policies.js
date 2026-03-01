import { createActionRuntimeError } from "./contracts.js";
import { normalizeLowerText, normalizeText } from "./textNormalization.js";

function defaultHasPermission(permissionSet, permission) {
  const requiredPermission = normalizeText(permission);
  if (!requiredPermission) {
    return true;
  }

  const normalizedPermissions = Array.isArray(permissionSet)
    ? permissionSet.map((entry) => normalizeText(entry)).filter(Boolean)
    : [];

  return normalizedPermissions.includes("*") || normalizedPermissions.includes(requiredPermission);
}

function createPermissionEvaluator({ hasPermissionFn = defaultHasPermission } = {}) {
  const hasPermission = typeof hasPermissionFn === "function" ? hasPermissionFn : defaultHasPermission;

  async function evaluate({ definition, context, input }) {
    const policy = definition?.permission;

    if (typeof policy === "function") {
      const resolution = await policy(context, input);
      if (typeof resolution === "boolean") {
        return {
          allowed: resolution,
          reason: resolution ? "allowed" : "forbidden",
          code: resolution ? "ACTION_PERMISSION_ALLOWED" : "ACTION_PERMISSION_DENIED"
        };
      }

      if (resolution && typeof resolution === "object") {
        return {
          allowed: resolution.allowed === true,
          reason: normalizeText(resolution.reason || "forbidden") || "forbidden",
          code: normalizeText(resolution.code || "ACTION_PERMISSION_DENIED") || "ACTION_PERMISSION_DENIED"
        };
      }

      return {
        allowed: false,
        reason: "forbidden",
        code: "ACTION_PERMISSION_DENIED"
      };
    }

    const requiredPermissions = Array.isArray(policy) ? policy : [];
    const actorPermissions = Array.isArray(context?.permissions) ? context.permissions : [];

    for (const permission of requiredPermissions) {
      if (!hasPermission(actorPermissions, permission)) {
        return {
          allowed: false,
          reason: "forbidden",
          code: "ACTION_PERMISSION_DENIED"
        };
      }
    }

    return {
      allowed: true,
      reason: "allowed",
      code: "ACTION_PERMISSION_ALLOWED"
    };
  }

  return {
    evaluate
  };
}

function ensureActionChannelAllowed(definition, context) {
  const channel = normalizeLowerText(context?.channel);
  const allowedChannels = Array.isArray(definition?.channels) ? definition.channels : [];

  if (!channel || !allowedChannels.includes(channel)) {
    throw createActionRuntimeError(403, "Forbidden.", {
      code: "ACTION_CHANNEL_FORBIDDEN",
      details: {
        actionId: definition?.id,
        channel
      }
    });
  }
}

function ensureActionSurfaceAllowed(definition, context) {
  const surface = normalizeLowerText(context?.surface);
  const allowedSurfaces = Array.isArray(definition?.surfaces) ? definition.surfaces : [];

  if (!surface || !allowedSurfaces.includes(surface)) {
    throw createActionRuntimeError(403, "Forbidden.", {
      code: "ACTION_SURFACE_FORBIDDEN",
      details: {
        actionId: definition?.id,
        surface
      }
    });
  }
}

function ensureActionVisibilityAllowed(definition, context) {
  const visibility = normalizeLowerText(definition?.visibility || "public");
  if (visibility === "internal") {
    const actorIsOperator =
      context?.actor?.isOperator === true ||
      (Array.isArray(context?.permissions) &&
        (context.permissions.includes("console.operator") || context.permissions.includes("*")));

    if (actorIsOperator || !context?.actor) {
      return;
    }

    throw createActionRuntimeError(403, "Forbidden.", {
      code: "ACTION_VISIBILITY_FORBIDDEN",
      details: {
        actionId: definition?.id,
        visibility
      }
    });
  }

  if (visibility !== "operator") {
    return;
  }

  const actorIsOperator =
    context?.actor?.isOperator === true ||
    (Array.isArray(context?.permissions) &&
      (context.permissions.includes("console.operator") || context.permissions.includes("*")));

  if (!actorIsOperator) {
    throw createActionRuntimeError(403, "Forbidden.", {
      code: "ACTION_VISIBILITY_FORBIDDEN",
      details: {
        actionId: definition?.id,
        visibility
      }
    });
  }
}

function normalizeSchemaValidationErrors(schema) {
  const errors = Array.isArray(schema?.errors) ? schema.errors : [];
  if (errors.length < 1) {
    return null;
  }

  const fieldErrors = {};
  for (const entry of errors) {
    const fieldPath = normalizeText(entry?.path || entry?.instancePath || entry?.field || "") || "input";
    const message = normalizeText(entry?.message || "Invalid value.") || "Invalid value.";
    fieldErrors[fieldPath] = message;
  }

  return Object.keys(fieldErrors).length > 0 ? fieldErrors : null;
}

function buildSchemaContractError({ phase, definition } = {}) {
  return createActionRuntimeError(400, "Validation failed.", {
    code: "ACTION_VALIDATION_FAILED",
    details: {
      error: "Schema validator must return { ok, value, errors } or throw.",
      phase,
      actionId: definition?.id,
      version: definition?.version
    }
  });
}

function normalizeFunctionSchemaResult(result, payload, { phase, definition } = {}) {
  if (!result || typeof result !== "object" || Array.isArray(result) || typeof result.ok !== "boolean") {
    throw buildSchemaContractError({ phase, definition });
  }

  if (result.ok) {
    if (Object.prototype.hasOwnProperty.call(result, "value")) {
      return result.value;
    }
    return payload;
  }

  const details = {};
  if (Object.prototype.hasOwnProperty.call(result, "errors")) {
    if (Array.isArray(result.errors)) {
      const fieldErrors = normalizeSchemaValidationErrors({ errors: result.errors });
      if (fieldErrors) {
        details.fieldErrors = fieldErrors;
      } else {
        details.errors = result.errors;
      }
    } else if (result.errors && typeof result.errors === "object") {
      details.fieldErrors = result.errors;
    } else if (result.errors != null) {
      details.error = String(result.errors);
    }
  }

  throw createActionRuntimeError(400, "Validation failed.", {
    code: "ACTION_VALIDATION_FAILED",
    details: Object.keys(details).length > 0 ? details : undefined
  });
}

async function validateSchemaPayload(schema, payload, { phase, definition }) {
  if (typeof schema === "function") {
    const result = await schema(payload, {
      phase,
      actionId: definition?.id,
      version: definition?.version
    });
    return normalizeFunctionSchemaResult(result, payload, { phase, definition });
  }

  if (!schema || typeof schema !== "object") {
    return payload;
  }

  if (typeof schema.parse === "function") {
    return schema.parse(payload);
  }

  if (typeof schema.assert === "function") {
    const assertionResult = await schema.assert(payload);
    return assertionResult == null ? payload : assertionResult;
  }

  if (typeof schema.check === "function") {
    const valid = await schema.check(payload);
    if (!valid) {
      throw createActionRuntimeError(400, "Validation failed.", {
        code: "ACTION_VALIDATION_FAILED"
      });
    }
    return payload;
  }

  if (typeof schema.validate === "function") {
    const valid = await schema.validate(payload);
    if (!valid) {
      throw createActionRuntimeError(400, "Validation failed.", {
        code: "ACTION_VALIDATION_FAILED",
        details: {
          fieldErrors: normalizeSchemaValidationErrors(schema)
        }
      });
    }
    return payload;
  }

  return payload;
}

async function normalizeActionInput(definition, input, context) {
  try {
    return await validateSchemaPayload(definition?.inputSchema, input, {
      phase: "input",
      definition,
      context
    });
  } catch (error) {
    if (error?.code === "ACTION_VALIDATION_FAILED") {
      throw error;
    }

    throw createActionRuntimeError(400, "Validation failed.", {
      code: "ACTION_VALIDATION_FAILED",
      details: {
        error: String(error?.message || "Invalid input.")
      },
      cause: error
    });
  }
}

async function normalizeActionOutput(definition, output, context) {
  if (!definition?.outputSchema) {
    return output;
  }

  try {
    return await validateSchemaPayload(definition.outputSchema, output, {
      phase: "output",
      definition,
      context
    });
  } catch (error) {
    if (error?.code === "ACTION_VALIDATION_FAILED") {
      throw createActionRuntimeError(500, "Action output validation failed.", {
        code: "ACTION_OUTPUT_VALIDATION_FAILED",
        details: error.details,
        cause: error
      });
    }

    throw createActionRuntimeError(500, "Action output validation failed.", {
      code: "ACTION_OUTPUT_VALIDATION_FAILED",
      details: {
        error: String(error?.message || "Invalid output.")
      },
      cause: error
    });
  }
}

const __testables = {
  normalizeText,
  normalizeLowerText,
  defaultHasPermission,
  normalizeSchemaValidationErrors,
  validateSchemaPayload
};

export {
  createPermissionEvaluator,
  ensureActionChannelAllowed,
  ensureActionSurfaceAllowed,
  ensureActionVisibilityAllowed,
  normalizeActionInput,
  normalizeActionOutput,
  __testables
};
