import { Check, Errors } from "typebox/value";
import { createActionRuntimeError } from "./actionDefinitions.js";
import { normalizeLowerText, normalizeText } from "./textNormalization.js";

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

function ensureActionConsoleUsersOnlyAllowed(definition, context) {
  if (definition?.consoleUsersOnly !== true) {
    return;
  }

  const actorIsOperator =
    context?.actor?.isOperator === true ||
    (Array.isArray(context?.permissions) &&
      (context.permissions.includes("console.operator") || context.permissions.includes("*")));

  if (!actorIsOperator) {
    throw createActionRuntimeError(403, "Forbidden.", {
      code: "ACTION_CONSOLE_USERS_ONLY_FORBIDDEN",
      details: {
        actionId: definition?.id,
        consoleUsersOnly: true
      }
    });
  }
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 0;
  }

  return parsed;
}

function normalizePermissionList(value) {
  const source = Array.isArray(value) ? value : [value];
  return source.map((entry) => normalizeText(entry)).filter(Boolean);
}

function hasPermission(permissionSet = [], permission = "") {
  const requiredPermission = normalizeText(permission);
  if (!requiredPermission) {
    return true;
  }

  const permissions = normalizePermissionList(permissionSet);
  return permissions.includes("*") || permissions.includes(requiredPermission);
}

function ensureActionPermissionAllowed(definition, context) {
  const permission = definition?.permission && typeof definition.permission === "object"
    ? definition.permission
    : { require: "none" };
  const mode = normalizeLowerText(permission.require || "none");

  if (mode === "none") {
    return;
  }

  const actorId = toPositiveInteger(context?.actor?.id);
  if (actorId < 1) {
    throw createActionRuntimeError(401, permission.message || "Authentication required.", {
      code: permission.code || "ACTION_AUTHENTICATION_REQUIRED",
      details: {
        actionId: definition?.id
      }
    });
  }

  if (mode === "authenticated") {
    return;
  }

  const requiredPermissions = normalizePermissionList(permission.permissions);
  if (requiredPermissions.length < 1) {
    return;
  }

  const actorPermissions = normalizePermissionList(context?.permissions);
  if (mode === "all") {
    for (const requiredPermission of requiredPermissions) {
      if (hasPermission(actorPermissions, requiredPermission)) {
        continue;
      }

      throw createActionRuntimeError(403, permission.message || "Forbidden.", {
        code: permission.code || "ACTION_PERMISSION_DENIED",
        details: {
          actionId: definition?.id,
          permission: requiredPermission
        }
      });
    }

    return;
  }

  const hasAnyPermission = requiredPermissions.some((requiredPermission) => hasPermission(actorPermissions, requiredPermission));
  if (!hasAnyPermission) {
    throw createActionRuntimeError(403, permission.message || "Forbidden.", {
      code: permission.code || "ACTION_PERMISSION_DENIED",
      details: {
        actionId: definition?.id,
        requiredPermissions
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

function buildSchemaValidatorError({ phase, definition } = {}) {
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

function normalizeTypeBoxValidationErrors(schema, payload) {
  const issues = Check(schema, payload) ? [] : [...Errors(schema, payload)];
  if (issues.length < 1) {
    return null;
  }

  return normalizeSchemaValidationErrors({
    errors: issues
  });
}

function normalizeFunctionSchemaResult(result, payload, { phase, definition } = {}) {
  if (!result || typeof result !== "object" || Array.isArray(result) || typeof result.ok !== "boolean") {
    throw buildSchemaValidatorError({ phase, definition });
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

async function normalizeValidatorPayload(validator, payload, { phase, definition, context }) {
  if (!validator || typeof validator !== "object") {
    return payload;
  }

  if (typeof validator.normalize !== "function") {
    return payload;
  }

  return await validator.normalize(payload, {
    phase,
    actionId: definition?.id,
    version: definition?.version,
    context
  });
}

async function validateSchemaPayload(schema, payload, { phase, definition }) {
  if (schema == null) {
    return payload;
  }

  if (typeof schema === "function") {
    const result = await schema(payload, {
      phase,
      actionId: definition?.id,
      version: definition?.version
    });
    return normalizeFunctionSchemaResult(result, payload, { phase, definition });
  }

  if (typeof schema !== "object" || Array.isArray(schema)) {
    throw buildSchemaValidatorError({ phase, definition });
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

  const fieldErrors = normalizeTypeBoxValidationErrors(schema, payload);
  if (!fieldErrors) {
    return payload;
  }

  throw createActionRuntimeError(400, "Validation failed.", {
    code: "ACTION_VALIDATION_FAILED",
    details: {
      fieldErrors
    }
  });
}

async function normalizeActionInput(definition, input, context) {
  try {
    const normalizedInput = await normalizeValidatorPayload(definition?.inputValidator, input, {
      phase: "input",
      definition,
      context
    });

    return await validateSchemaPayload(definition?.inputValidator?.schema, normalizedInput, {
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
  if (!definition?.outputValidator) {
    return output;
  }

  try {
    const normalizedOutput = await normalizeValidatorPayload(definition.outputValidator, output, {
      phase: "output",
      definition,
      context
    });

    return await validateSchemaPayload(definition.outputValidator.schema, normalizedOutput, {
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
  normalizeSchemaValidationErrors,
  normalizeTypeBoxValidationErrors,
  normalizeValidatorPayload,
  validateSchemaPayload
};

export {
  ensureActionChannelAllowed,
  ensureActionSurfaceAllowed,
  ensureActionConsoleUsersOnlyAllowed,
  ensureActionPermissionAllowed,
  normalizeActionInput,
  normalizeActionOutput,
  __testables
};
