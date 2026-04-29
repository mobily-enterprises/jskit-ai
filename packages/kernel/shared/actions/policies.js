import { createActionRuntimeError } from "./actionDefinitions.js";
import { normalizeLowerText, normalizeText } from "./textNormalization.js";
import { hasPermission, normalizePermissionList } from "../support/permissions.js";
import { isRecord, normalizeOpaqueId } from "../support/normalize.js";
import {
  normalizeSchemaValidationErrors,
  validateSingleSchemaPayloadSync,
  validateSingleSchemaPayload,
  validateSchemaPayload
} from "../validators/schemaPayloadValidation.js";

function createActionValidationError({
  status = 400,
  message = "Validation failed.",
  code = "ACTION_VALIDATION_FAILED",
  details,
  cause
} = {}) {
  return createActionRuntimeError(status, message, {
    code,
    details,
    cause
  });
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

function ensureActionPermissionAllowed(definition, context) {
  const permission = isRecord(definition?.permission) ? definition.permission : { require: "none" };
  const mode = normalizeLowerText(permission.require || "none");

  if (mode === "none") {
    return;
  }

  const actorId = normalizeOpaqueId(context?.actor?.id);
  if (actorId == null) {
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

async function normalizeActionInput(definition, input, context) {
  try {
    return await validateSchemaPayload(definition?.input, input, {
      phase: "input",
      definition,
      context
    });
  } catch (error) {
    if (isRecord(error?.fieldErrors) || isRecord(error?.details?.fieldErrors)) {
      throw createActionValidationError({
        details: {
          fieldErrors: error.fieldErrors || error.details?.fieldErrors
        },
        cause: error
      });
    }
    if (error?.code === "ACTION_VALIDATION_FAILED") {
      throw error;
    }

    throw createActionValidationError({
      details: {
        error: String(error?.message || "Invalid input.")
      },
      cause: error
    });
  }
}

async function normalizeActionOutput(definition, output, context) {
  if (!definition?.output) {
    return output;
  }

  try {
    return await validateSchemaPayload(definition.output, output, {
      phase: "output",
      definition,
      context
    });
  } catch (error) {
    if (isRecord(error?.fieldErrors) || isRecord(error?.details?.fieldErrors)) {
      throw createActionValidationError({
        status: 500,
        message: "Action output validation failed.",
        code: "ACTION_OUTPUT_VALIDATION_FAILED",
        details: {
          fieldErrors: error.fieldErrors || error.details?.fieldErrors
        },
        cause: error
      });
    }
    if (error?.code === "ACTION_VALIDATION_FAILED") {
      throw createActionValidationError({
        status: 500,
        message: "Action output validation failed.",
        code: "ACTION_OUTPUT_VALIDATION_FAILED",
        details: error.details,
        cause: error
      });
    }

    throw createActionValidationError({
      status: 500,
      message: "Action output validation failed.",
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
  validateSingleSchemaPayloadSync,
  validateSingleSchemaPayload,
  validateSchemaPayload
};

export {
  ensureActionChannelAllowed,
  ensureActionSurfaceAllowed,
  ensureActionPermissionAllowed,
  normalizeActionInput,
  normalizeActionOutput,
  __testables
};
