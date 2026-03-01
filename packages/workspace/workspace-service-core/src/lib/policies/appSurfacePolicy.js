import { normalizeEmail } from "@jskit-ai/access-core/utils";

function normalizeDenyUserIds(rawUserIds) {
  if (!Array.isArray(rawUserIds)) {
    return [];
  }

  return Array.from(
    new Set(rawUserIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))
  );
}

function normalizeDenyEmails(rawEmails) {
  if (!Array.isArray(rawEmails)) {
    return [];
  }

  return Array.from(new Set(rawEmails.map((value) => normalizeEmail(value)).filter(Boolean)));
}

function extractAppSurfacePolicy(workspaceSettings) {
  const features =
    workspaceSettings?.features && typeof workspaceSettings.features === "object" ? workspaceSettings.features : {};
  const surfaceAccess =
    features.surfaceAccess && typeof features.surfaceAccess === "object" ? features.surfaceAccess : {};
  const appPolicy = surfaceAccess.app && typeof surfaceAccess.app === "object" ? surfaceAccess.app : {};

  return {
    denyUserIds: normalizeDenyUserIds(appPolicy.denyUserIds),
    denyEmails: normalizeDenyEmails(appPolicy.denyEmails)
  };
}

export { normalizeDenyUserIds, normalizeDenyEmails, extractAppSurfacePolicy };
