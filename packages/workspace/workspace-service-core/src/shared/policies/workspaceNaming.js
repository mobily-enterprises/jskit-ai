function toSlugPart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function buildWorkspaceName(userProfile) {
  const displayName = String(userProfile?.displayName || "").trim();
  if (displayName) {
    return `${displayName} Workspace`.slice(0, 160);
  }

  const emailLocalPart = String(userProfile?.email || "").split("@")[0];
  if (emailLocalPart) {
    return `${emailLocalPart} Workspace`.slice(0, 160);
  }

  return `Workspace ${Number(userProfile?.id) || ""}`.trim();
}

function buildWorkspaceBaseSlug(userProfile) {
  const displaySlug = toSlugPart(userProfile?.displayName);
  if (displaySlug) {
    return displaySlug.slice(0, 90);
  }

  const emailLocalPart = String(userProfile?.email || "").split("@")[0];
  const emailSlug = toSlugPart(emailLocalPart);
  if (emailSlug) {
    return emailSlug.slice(0, 90);
  }

  return `user-${Number(userProfile?.id) || "workspace"}`;
}

export { toSlugPart, buildWorkspaceName, buildWorkspaceBaseSlug };
