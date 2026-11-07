import { defineFeature } from "@jskit-ai/kernel/server/features";

/**
 * A feature's system context, as this feature derives scoped contexts from it.
 * @typedef {(reason: string) => import("./types.js").RealtimeAudienceScope} SystemContextFactory
 */

/**
 * The contexts an audience's audienceUsers reads in, scoped to the event's own
 * workspace, user, or user in a workspace.
 * @param {SystemContextFactory} systemContext
 * @returns {import("./types.js").RealtimeAudienceScope}
 */
function audienceScopeFor(systemContext) {
  const reading = () => systemContext("read the users a realtime event's audience reaches, in the event's scope");
  return Object.freeze({
    forWorkspace: (workspaceId) => reading().forWorkspace(workspaceId),
    forUser: (userId) => reading().forUser(userId),
    forWorkspaceUser: (workspaceId, userId) => reading().forWorkspaceUser(workspaceId, userId)
  });
}

// An application whose realtime audiences read owned tables registers this
// feature, so each audience reads in its event's scope. Realtime itself needs no
// database: without it, audiences read with no context.
const RealtimeAudienceScopeFeature = defineFeature({
  id: "realtime.audience-scope",
  systemScope: "read the users a realtime event's audience reaches, scoped to the event's workspace or user",
  provides: {
    audienceScope: "realtime.audience-scope"
  },
  /** @param {{ systemContext: SystemContextFactory }} capabilities */
  setup({ systemContext }) {
    return { audienceScope: audienceScopeFor(systemContext) };
  }
});

export { RealtimeAudienceScopeFeature };
