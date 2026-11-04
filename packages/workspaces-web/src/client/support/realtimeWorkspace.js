import { unref } from "vue";

function matchesCurrentWorkspaceEvent(payload, workspaceSlug = "") {
  const payloadWorkspaceSlug = String(payload?.workspaceSlug || "").trim();
  if (!payloadWorkspaceSlug) {
    return true;
  }

  return payloadWorkspaceSlug === String(workspaceSlug || "").trim();
}

/**
 * What a workspace page listens with: an event for another workspace is not for it.
 * @param {import("vue").MaybeRef<string>} workspaceSlugRef
 */
function createWorkspaceRealtimeMatcher(workspaceSlugRef) {
  return function matchesWorkspaceRealtimeEvent({ payload }) {
    return matchesCurrentWorkspaceEvent(payload, unref(workspaceSlugRef));
  };
}

export {
  matchesCurrentWorkspaceEvent,
  createWorkspaceRealtimeMatcher
};
