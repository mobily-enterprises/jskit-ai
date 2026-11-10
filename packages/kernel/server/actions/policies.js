import { ActionRuntimeError } from "./actionDefinitions.js";
import { missingPermissionDetails, normalizePermissionList } from "../../shared/support/permissions.js";
import { isRecord, normalizeLowerText } from "../../shared/support/normalize.js";
import { resolveActorId } from "./actionContributorHelpers.js";
import { validateSchemaPayload } from "../../shared/validators/schemaPayloadValidation.js";

/** A schema validation error's fieldErrors with their codes, when it has any. */
function schemaFieldErrorDetails(error) {
  const fieldErrorCodes = error.fieldErrorCodes || error.details?.fieldErrorCodes;
  return {
    fieldErrors: error.fieldErrors || error.details?.fieldErrors,
    ...(isRecord(fieldErrorCodes) ? { fieldErrorCodes } : {})
  };
}

/**
 * A refused action input: its field errors, or the validator's own words, in details.
 * @param {object} failure
 * @param {object} failure.details
 * @param {unknown} failure.cause
 */
function buildActionValidationError({ details, cause }) {
  return new ActionRuntimeError(400, "Validation failed.", {
    code: "ACTION_VALIDATION_FAILED",
    details,
    cause
  });
}

function ensureActionChannelAllowed(definition, context) {
  const channel = normalizeLowerText(context.channel);

  if (!channel || !definition.channels.includes(channel)) {
    throw new ActionRuntimeError(403, "Forbidden.", {
      code: "ACTION_CHANNEL_FORBIDDEN",
      details: {
        actionId: definition.id,
        channel
      }
    });
  }
}

function ensureActionSurfaceAllowed(definition, context) {
  const surface = normalizeLowerText(context.surface);
  const allowedSurfaces = definition.surfaces;

  if (!allowedSurfaces.includes("*") && (!surface || !allowedSurfaces.includes(surface))) {
    throw new ActionRuntimeError(403, "Forbidden.", {
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

  const actorId = resolveActorId(context);
  if (actorId == null) {
    throw new ActionRuntimeError(401, permission.message || "Authentication required.", {
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

  const missing = missingPermissionDetails(mode, requiredPermissions, normalizePermissionList(context.permissions));
  if (missing) {
    throw new ActionRuntimeError(403, permission.message || "Forbidden.", {
      code: permission.code || "ACTION_PERMISSION_DENIED",
      details: {
        actionId: definition.id,
        ...missing
      }
    });
  }
}

function hasFieldErrors(error) {
  return isRecord(error?.fieldErrors) || isRecord(error?.details?.fieldErrors);
}

/**
 * The action's input as its schema validates it, then as its own checkInput judges it, when it has one: a check of
 * what the schema cannot judge until the application runs, such as a CRUD read's fieldsets for the types its includes
 * reach, which boot resolves. Either refusal is an ACTION_VALIDATION_FAILED naming each refused field, before the
 * action runs. checkInput refuses by throwing an error with field errors (createValidationError); any other error it
 * throws is a fault, and goes on as it is.
 * @param {import("../types.js").ActionDefinition} definition
 * @param {unknown} input
 */
async function normalizeActionInput(definition, input) {
  let normalized;
  try {
    normalized = validateSchemaPayload(definition.input, input, {
      phase: "input",
      context: `Action ${definition.id} input`
    });
  } catch (error) {
    if (hasFieldErrors(error)) {
      throw buildActionValidationError({
        details: schemaFieldErrorDetails(error),
        cause: error
      });
    }
    if (error?.code === "ACTION_VALIDATION_FAILED") {
      throw error;
    }

    throw buildActionValidationError({
      details: {
        error: String(error?.message || "Invalid input.")
      },
      cause: error
    });
  }

  if (definition.checkInput) {
    try {
      await definition.checkInput(normalized);
    } catch (error) {
      throw hasFieldErrors(error) ? buildActionValidationError({ details: schemaFieldErrorDetails(error), cause: error }) : error;
    }
  }
  return normalized;
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
    // Output the action itself produced is a server fault: a hidden internal failure, with the validator's findings as its cause.
    throw new Error("Action output validation failed.", { cause: error });
  }
}

export {
  ensureActionChannelAllowed,
  ensureActionSurfaceAllowed,
  ensureActionPermissionAllowed,
  normalizeActionInput,
  normalizeActionOutput
};
