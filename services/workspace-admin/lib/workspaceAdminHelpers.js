import { AppError } from "../../../lib/errors.js";
import { OWNER_ROLE_ID } from "../../../lib/rbacManifest.js";
import { SETTINGS_MODE_OPTIONS, SETTINGS_TIMING_OPTIONS } from "../../../shared/settings/index.js";

const BASIC_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_WORKSPACE_COLOR = "#0F6B54";
const WORKSPACE_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function parsePositiveInteger(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) {
    return null;
  }

  return numeric;
}

function normalizeWorkspaceAvatarUrl(value) {
  if (value == null) {
    return "";
  }

  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          avatarUrl: "Workspace avatar URL must be a valid absolute URL."
        }
      }
    });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          avatarUrl: "Workspace avatar URL must start with http:// or https://."
        }
      }
    });
  }

  return parsed.toString();
}

function coerceWorkspaceColor(value) {
  const normalized = String(value || "").trim();
  if (WORKSPACE_COLOR_PATTERN.test(normalized)) {
    return normalized.toUpperCase();
  }

  return DEFAULT_WORKSPACE_COLOR;
}

function normalizeWorkspaceColor(value) {
  const normalized = String(value || "").trim();
  if (WORKSPACE_COLOR_PATTERN.test(normalized)) {
    return normalized.toUpperCase();
  }

  throw new AppError(400, "Validation failed.", {
    details: {
      fieldErrors: {
        color: "Workspace color must be a hex color like #0F6B54."
      }
    }
  });
}

function toRoleDescriptor(roleId, role) {
  const normalizedRole = role && typeof role === "object" ? role : {};
  const permissions = Array.isArray(normalizedRole.permissions)
    ? Array.from(
        new Set(
          normalizedRole.permissions.map((permission) => String(permission || "").trim()).filter(Boolean)
        )
      )
    : [];

  return {
    id: String(roleId || ""),
    assignable: Boolean(normalizedRole.assignable),
    permissions
  };
}

function listRoleDescriptors(rbacManifest) {
  const roles = rbacManifest && typeof rbacManifest.roles === "object" ? rbacManifest.roles : {};
  const descriptors = Object.entries(roles)
    .map(([roleId, role]) => toRoleDescriptor(roleId, role))
    .filter((role) => role.id)
    .sort((left, right) => {
      if (left.id === OWNER_ROLE_ID) {
        return -1;
      }
      if (right.id === OWNER_ROLE_ID) {
        return 1;
      }

      return left.id.localeCompare(right.id);
    });

  return descriptors;
}

function resolveAssignableRoleIds(rbacManifest) {
  return listRoleDescriptors(rbacManifest)
    .filter((role) => role.id !== OWNER_ROLE_ID && role.assignable)
    .map((role) => role.id);
}

function resolveWorkspaceDefaults(policy) {
  const normalizedPolicy = policy && typeof policy === "object" ? policy : {};

  const defaultModeCandidate = String(normalizedPolicy.defaultMode || "").trim().toLowerCase();
  const defaultTimingCandidate = String(normalizedPolicy.defaultTiming || "").trim().toLowerCase();
  const defaultPaymentsPerYearCandidate = Number(normalizedPolicy.defaultPaymentsPerYear);
  const defaultHistoryPageSizeCandidate = Number(normalizedPolicy.defaultHistoryPageSize);

  return {
    defaultMode: SETTINGS_MODE_OPTIONS.includes(defaultModeCandidate) ? defaultModeCandidate : "fv",
    defaultTiming: SETTINGS_TIMING_OPTIONS.includes(defaultTimingCandidate) ? defaultTimingCandidate : "ordinary",
    defaultPaymentsPerYear:
      Number.isInteger(defaultPaymentsPerYearCandidate) &&
      defaultPaymentsPerYearCandidate >= 1 &&
      defaultPaymentsPerYearCandidate <= 365
        ? defaultPaymentsPerYearCandidate
        : 12,
    defaultHistoryPageSize:
      Number.isInteger(defaultHistoryPageSizeCandidate) &&
      defaultHistoryPageSizeCandidate >= 1 &&
      defaultHistoryPageSizeCandidate <= 100
        ? defaultHistoryPageSizeCandidate
        : 10
  };
}

function normalizeDenyUserIds(rawUserIds) {
  if (!Array.isArray(rawUserIds)) {
    return {
      value: null,
      valid: false
    };
  }

  const normalized = [];
  for (const rawUserId of rawUserIds) {
    const numericUserId = Number(rawUserId);
    if (!Number.isInteger(numericUserId) || numericUserId < 1) {
      return {
        value: null,
        valid: false
      };
    }
    normalized.push(numericUserId);
  }

  return {
    value: Array.from(new Set(normalized)),
    valid: true
  };
}

function normalizeDenyEmails(rawEmails) {
  if (!Array.isArray(rawEmails)) {
    return {
      value: null,
      valid: false
    };
  }

  const normalized = [];
  for (const rawEmail of rawEmails) {
    const email = normalizeEmail(rawEmail);
    if (!email || !BASIC_EMAIL_PATTERN.test(email)) {
      return {
        value: null,
        valid: false
      };
    }
    normalized.push(email);
  }

  return {
    value: Array.from(new Set(normalized)),
    valid: true
  };
}

function parseWorkspaceSettingsPatch(payload) {
  const body = payload && typeof payload === "object" ? payload : {};
  const fieldErrors = {};
  const workspacePatch = {};
  const settingsPatch = {};
  const defaultsPatch = {};

  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    const name = String(body.name || "").trim();
    if (!name) {
      fieldErrors.name = "Workspace name is required.";
    } else if (name.length > 160) {
      fieldErrors.name = "Workspace name must be at most 160 characters.";
    } else {
      workspacePatch.name = name;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "avatarUrl")) {
    try {
      workspacePatch.avatarUrl = normalizeWorkspaceAvatarUrl(body.avatarUrl);
    } catch (error) {
      if (error instanceof AppError && error.details?.fieldErrors?.avatarUrl) {
        fieldErrors.avatarUrl = String(error.details.fieldErrors.avatarUrl);
      } else {
        fieldErrors.avatarUrl = "Workspace avatar URL is invalid.";
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "color")) {
    try {
      workspacePatch.color = normalizeWorkspaceColor(body.color);
    } catch (error) {
      if (error instanceof AppError && error.details?.fieldErrors?.color) {
        fieldErrors.color = String(error.details.fieldErrors.color);
      } else {
        fieldErrors.color = "Workspace color is invalid.";
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "invitesEnabled")) {
    if (typeof body.invitesEnabled !== "boolean") {
      fieldErrors.invitesEnabled = "Invites enabled must be a boolean.";
    } else {
      settingsPatch.invitesEnabled = body.invitesEnabled;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "defaultMode")) {
    const value = String(body.defaultMode || "").trim().toLowerCase();
    if (!SETTINGS_MODE_OPTIONS.includes(value)) {
      fieldErrors.defaultMode = "Default mode must be fv or pv.";
    } else {
      defaultsPatch.defaultMode = value;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "defaultTiming")) {
    const value = String(body.defaultTiming || "").trim().toLowerCase();
    if (!SETTINGS_TIMING_OPTIONS.includes(value)) {
      fieldErrors.defaultTiming = "Default timing must be ordinary or due.";
    } else {
      defaultsPatch.defaultTiming = value;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "defaultPaymentsPerYear")) {
    const value = Number(body.defaultPaymentsPerYear);
    if (!Number.isInteger(value) || value < 1 || value > 365) {
      fieldErrors.defaultPaymentsPerYear = "Default payments per year must be an integer from 1 to 365.";
    } else {
      defaultsPatch.defaultPaymentsPerYear = value;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "defaultHistoryPageSize")) {
    const value = Number(body.defaultHistoryPageSize);
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      fieldErrors.defaultHistoryPageSize = "Default history page size must be an integer from 1 to 100.";
    } else {
      defaultsPatch.defaultHistoryPageSize = value;
    }
  }

  if (Object.keys(defaultsPatch).length > 0) {
    settingsPatch.defaults = defaultsPatch;
  }

  let appSurfaceAccessPatch = null;

  if (Object.prototype.hasOwnProperty.call(body, "appDenyEmails")) {
    const parsedDenyEmails = normalizeDenyEmails(body.appDenyEmails);
    if (!parsedDenyEmails.valid) {
      fieldErrors.appDenyEmails = "App deny emails must be an array of valid email addresses.";
    } else {
      appSurfaceAccessPatch = {
        ...(appSurfaceAccessPatch || {}),
        denyEmails: parsedDenyEmails.value
      };
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "appDenyUserIds")) {
    const parsedDenyUserIds = normalizeDenyUserIds(body.appDenyUserIds);
    if (!parsedDenyUserIds.valid) {
      fieldErrors.appDenyUserIds = "App deny user ids must be an array of positive integers.";
    } else {
      appSurfaceAccessPatch = {
        ...(appSurfaceAccessPatch || {}),
        denyUserIds: parsedDenyUserIds.value
      };
    }
  }

  if (appSurfaceAccessPatch) {
    settingsPatch.appSurfaceAccess = appSurfaceAccessPatch;
  }

  return {
    workspacePatch,
    settingsPatch,
    fieldErrors
  };
}

function mapWorkspaceSummary(workspace) {
  return {
    id: Number(workspace.id),
    slug: String(workspace.slug || ""),
    name: String(workspace.name || ""),
    color: coerceWorkspaceColor(workspace.color),
    avatarUrl: workspace.avatarUrl ? String(workspace.avatarUrl) : "",
    ownerUserId: Number(workspace.ownerUserId),
    isPersonal: Boolean(workspace.isPersonal)
  };
}

export {
  normalizeEmail,
  parsePositiveInteger,
  coerceWorkspaceColor,
  listRoleDescriptors,
  resolveAssignableRoleIds,
  resolveWorkspaceDefaults,
  parseWorkspaceSettingsPatch,
  mapWorkspaceSummary
};
