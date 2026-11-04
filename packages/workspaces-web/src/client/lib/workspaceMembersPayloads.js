import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";

function toRoleTitle(roleSid) {
  const normalizedRoleId = String(roleSid || "").trim();
  if (!normalizedRoleId) {
    return "";
  }
  return normalizedRoleId.charAt(0).toUpperCase() + normalizedRoleId.slice(1);
}

function normalizeRoleCatalog(payload) {
  const source =
    payload?.roleCatalog && typeof payload.roleCatalog === "object"
      ? payload.roleCatalog
      : payload && typeof payload === "object"
        ? payload
        : {};

  const roles = Array.isArray(source.roles) ? source.roles : [];
  const assignableRoleIdsFromCatalog = Array.isArray(source.assignableRoleIds)
    ? source.assignableRoleIds
    : [];

  let assignableRoleIds = assignableRoleIdsFromCatalog
    .map((entry) => String(entry || "").trim().toLowerCase())
    .filter(Boolean);

  if (assignableRoleIds.length < 1) {
    assignableRoleIds = roles
      .filter((entry) => entry?.assignable === true)
      .map((entry) => String(entry?.id || "").trim().toLowerCase())
      .filter(Boolean);
  }

  const uniqueRoleIds = Array.from(new Set(assignableRoleIds));
  const roleLabels = Object.create(null);
  for (const role of roles) {
    const id = String(role?.id || "").trim().toLowerCase();
    const label = typeof role?.label === "string" ? role.label.trim() : "";
    if (id && label) {
      roleLabels[id] = label;
    }
  }
  const roleOptions = uniqueRoleIds.map((roleSid) => ({
    title: roleLabels[roleSid] || toRoleTitle(roleSid),
    value: roleSid
  }));

  const defaultInviteRole = String(source.defaultInviteRole || "")
    .trim()
    .toLowerCase();

  return {
    roleOptions,
    roleLabels,
    defaultInviteRole
  };
}

function normalizeMembers(entries) {
  const source = Array.isArray(entries) ? entries : [];
  return source.map((entry) => {
    const value = entry && typeof entry === "object" ? entry : {};
    return {
      userId: normalizeRecordId(value.userId, { fallback: "" }),
      roleSid: String(value.roleSid || "").trim().toLowerCase(),
      status: String(value.status || "").trim().toLowerCase(),
      displayName: String(value.displayName || "").trim(),
      email: String(value.email || "").trim().toLowerCase(),
      isOwner: Boolean(value.isOwner)
    };
  });
}

function normalizeInvites(entries) {
  const source = Array.isArray(entries) ? entries : [];
  return source.map((entry) => {
    const value = entry && typeof entry === "object" ? entry : {};
    return {
      id: normalizeRecordId(value.id, { fallback: "" }),
      email: String(value.email || "").trim().toLowerCase(),
      roleSid: String(value.roleSid || "").trim().toLowerCase(),
      status: String(value.status || "").trim().toLowerCase(),
      expiresAt: value.expiresAt || "",
      invitedByUserId: normalizeRecordId(value.invitedByUserId, { fallback: null })
    };
  });
}

function latestPage(pages) {
  if (!Array.isArray(pages) || pages.length < 1) {
    return null;
  }

  return pages[pages.length - 1];
}

export { latestPage, normalizeInvites, normalizeMembers, normalizeRoleCatalog };
