import { normalizeObject, normalizeText } from "../../shared/support/normalize.js";
import { hasPermission, normalizePermissionList } from "../../shared/support/permissions.js";
import { AppError } from "./errors.js";

const AUTH_REQUIRE_MODES = new Set(["none", "authenticated", "all", "any"]);

function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 0;
  }

  return parsed;
}

function resolveServiceContext(source = {}) {
  const payload = normalizeObject(source);

  if (payload.context && typeof payload.context === "object" && !Array.isArray(payload.context)) {
    return payload.context;
  }

  if (payload.actionContext && typeof payload.actionContext === "object" && !Array.isArray(payload.actionContext)) {
    return payload.actionContext;
  }

  return payload;
}

function resolveRequireMode(value) {
  const mode = normalizeText(value || "authenticated").toLowerCase();
  if (!AUTH_REQUIRE_MODES.has(mode)) {
    throw new TypeError("requireAuth options.require must be one of: none, authenticated, all, any.");
  }
  return mode;
}

function normalizeRequireAuthOptions(options = {}, { context = "requireAuth options" } = {}) {
  const source = normalizeObject(options);
  const mode = resolveRequireMode(source.require);
  const permissions = normalizePermissionList(source.permissions);

  return Object.freeze({
    require: mode,
    permissions: Object.freeze(permissions),
    message: normalizeText(source.message),
    code: normalizeText(source.code),
    context
  });
}

function requireAuthenticatedActor(context = {}, options = {}) {
  const actor = normalizeObject(context.actor);
  const actorId = toPositiveInteger(actor.id);

  if (actorId < 1) {
    throw new AppError(401, options.message || "Authentication required.", {
      code: options.code || "AUTHENTICATION_REQUIRED"
    });
  }

  return {
    ...actor,
    id: actorId
  };
}

function requireAuth(source = {}, options = {}) {
  const context = resolveServiceContext(source);
  const settings = normalizeRequireAuthOptions(options);
  const mode = settings.require;

  if (mode === "none") {
    return null;
  }

  const actor = requireAuthenticatedActor(context, settings);

  if (mode === "authenticated") {
    return actor;
  }

  const requiredPermissions = normalizePermissionList(settings.permissions);
  if (requiredPermissions.length < 1) {
    return actor;
  }
  const actorPermissions = normalizePermissionList(context.permissions);

  if (mode === "all") {
    for (const permission of requiredPermissions) {
      if (hasPermission(actorPermissions, permission)) {
        continue;
      }

      throw new AppError(403, settings.message || "Forbidden.", {
        code: settings.code || "PERMISSION_DENIED",
        details: {
          permission
        }
      });
    }
    return actor;
  }

  const allowed = requiredPermissions.some((permission) => hasPermission(actorPermissions, permission));
  if (!allowed) {
    throw new AppError(403, settings.message || "Forbidden.", {
      code: settings.code || "PERMISSION_DENIED",
      details: {
        requiredPermissions
      }
    });
  }

  return actor;
}

export {
  resolveServiceContext,
  hasPermission,
  requireAuth
};
