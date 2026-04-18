import { unref } from "vue";

function matchesCurrentWorkspaceEvent(payload = {}, workspaceSlug = "") {
  const payloadWorkspaceSlug = String(payload?.workspaceSlug || "").trim();
  if (!payloadWorkspaceSlug) {
    return true;
  }

  return payloadWorkspaceSlug === String(workspaceSlug || "").trim();
}

function createWorkspaceRealtimeMatcher(workspaceSlugRef) {
  return function matchesWorkspaceRealtimeEvent({ payload = {} } = {}) {
    return matchesCurrentWorkspaceEvent(payload, unref(workspaceSlugRef));
  };
}

export {
  matchesCurrentWorkspaceEvent,
  createWorkspaceRealtimeMatcher
};
