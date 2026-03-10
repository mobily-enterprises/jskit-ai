import {
  normalizeObject,
  OBJECT_INPUT_SCHEMA,
  requireAuthenticated,
  resolveUser
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";

const workspacePendingInvitationsActions = Object.freeze([
  {
    id: "workspace.invitations.pending.list",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    input: { schema: OBJECT_INPUT_SCHEMA },
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "workspace.invitations.pending.list"
    },
    observability: {},
    async execute(input, context, deps) {
      return {
        pendingInvites: await deps.workspaceService.listPendingInvitesForUser(resolveUser(context, input))
      };
    }
  },
  {
    id: "workspace.invite.redeem",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    input: { schema: OBJECT_INPUT_SCHEMA },
    permission: requireAuthenticated,
    idempotency: "optional",
    audit: {
      actionName: "workspace.invite.redeem"
    },
    observability: {},
    async execute(input, context, deps) {
      const payload = normalizeObject(input);
      return deps.workspaceAdminService.respondToPendingInviteByToken({
        user: resolveUser(context, payload),
        inviteToken: payload.token || payload.inviteToken,
        decision: payload.decision
      });
    }
  }
]);

export { workspacePendingInvitationsActions };
