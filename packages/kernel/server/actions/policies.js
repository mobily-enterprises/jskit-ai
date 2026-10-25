import { createActionRuntimeError } from "./actionDefinitions.js";
import { hasPermission, normalizePermissionList } from "../../shared/support/permissions.js";
import { isRecord, normalizeLowerText, normalizeOpaqueId } from "../../shared/support/normalize.js";
import { validateSchemaPayload } from "../../shared/validators/schemaPayloadValidation.js";

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

  if (!channel || !definition.channels.includes(channel)) {
    throw createActionRuntimeError(403, "Forbidden.", {
      code: "ACTION_CHANNEL_FORBIDDEN",
      details: {
        actionId: definition.id,
        channel
      }
    });
  }
}

function ensureActionSurfaceAllowed(definition, context) {
  const surface = normalizeLowerText(context?.surface);
  const allowedSurfaces = definition.surfaces;

  if (!allowedSurfaces.includes("*") && (!surface || !allowedSurfaces.includes(surface))) {
    throw createActionRuntimeError(403, "Forbidden.", {
      code: "ACTION_SURFACE_FORBIDDEN",
      details: {
        actionId: definition.id,
        surface
      }
    });
  }
}

function ensureActionPermissionAllowed(definition, context) {
  const { permission } = definition;
  const mode = permission.require;

  if (mode === "none") {
    return;
  }

  const actorId = normalizeOpaqueId(context?.actor?.id);
  if (actorId == null) {
    throw createActionRuntimeError(401, permission.message || "Authentication required.", {
      code: permission.code || "ACTION_AUTHENTICATION_REQUIRED",
      details: {
        actionId: definition.id
      }
    });
  }

  if (mode === "authenticated") {
    return;
  }

  const requiredPermissions = permission.permissions;
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
          actionId: definition.id,
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
        actionId: definition.id,
        requiredPermissions
      }
    });
  }
}

async function normalizeActionInput(definition, input) {
  try {
    return validateSchemaPayload(definition.input, input, {
      phase: "input",
      context: `Action ${definition.id} input`
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

async function normalizeActionOutput(definition, output) {
  if (!definition.output) {
    return output;
  }

  try {
    return validateSchemaPayload(definition.output, output, {
      phase: "output",
      context: `Action ${definition.id} output`
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

export {
  ensureActionChannelAllowed,
  ensureActionSurfaceAllowed,
  ensureActionPermissionAllowed,
  normalizeActionInput,
  normalizeActionOutput
};
