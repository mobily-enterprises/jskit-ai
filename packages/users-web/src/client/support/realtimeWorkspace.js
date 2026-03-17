function matchesCurrentWorkspaceEvent(payload = {}, workspaceSlug = "") {
  const payloadWorkspaceSlug = String(payload?.workspaceSlug || "").trim();
  if (!payloadWorkspaceSlug) {
    return true;
  }

  return payloadWorkspaceSlug === String(workspaceSlug || "").trim();
}

export {
  matchesCurrentWorkspaceEvent
};
