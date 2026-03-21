import { ACCOUNT_SETTINGS_DEFAULTS } from "./accountSettingsRuntimeConstants.js";
import {
  normalizeReturnToPath as normalizeSharedReturnToPath,
  resolveAllowedOriginsFromPlacementContext
} from "@jskit-ai/kernel/shared/support";
import { normalizeRecord } from "../support/runtimeNormalization.js";

function normalizeReturnToPath(value, { fallback = "/", accountSettingsPath = "/account", allowedOrigins = [] } = {}) {
  return normalizeSharedReturnToPath(value, {
    fallback,
    allowedOrigins,
    blockedPathnames: [accountSettingsPath],
    pickFirstArrayValue: true
  });
}

function resolveAllowedReturnToOrigins(contextValue = null) {
  return resolveAllowedOriginsFromPlacementContext(contextValue);
}

function normalizeSettingsPayload(value) {
  return normalizeRecord(value);
}

function normalizePendingInvite(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const id = Number(entry.id);
  const workspaceId = Number(entry.workspaceId);
  if (!Number.isInteger(id) || id < 1 || !Number.isInteger(workspaceId) || workspaceId < 1) {
    return null;
  }

  const workspaceSlug = String(entry.workspaceSlug || "").trim();
  if (!workspaceSlug) {
    return null;
  }

  const token = String(entry.token || "").trim();
  if (!token) {
    return null;
  }

  return {
    id,
    token,
    workspaceId,
    workspaceSlug,
    workspaceName: String(entry.workspaceName || workspaceSlug).trim() || workspaceSlug,
    workspaceAvatarUrl: String(entry.workspaceAvatarUrl || "").trim(),
    roleId: String(entry.roleId || "member").trim().toLowerCase() || "member",
    status: String(entry.status || "pending").trim().toLowerCase() || "pending",
    expiresAt: String(entry.expiresAt || "").trim()
  };
}

function normalizeAvatarSize(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) {
    return ACCOUNT_SETTINGS_DEFAULTS.preferences.avatarSize;
  }

  const clamped = Math.min(128, Math.max(32, numeric));
  return clamped;
}

export {
  resolveAllowedReturnToOrigins,
  normalizeAvatarSize,
  normalizePendingInvite,
  normalizeReturnToPath,
  normalizeSettingsPayload
};
