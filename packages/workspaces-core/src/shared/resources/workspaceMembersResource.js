import { RECORD_ID_PATTERN } from "@jskit-ai/kernel/shared/validators";
import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { defineResource } from "@jskit-ai/resource-core/shared/resource";
import { OPERATION_MESSAGES } from "../operationMessages.js";
import { workspaceRoleCatalogSchema } from "./workspaceRoleCatalogSchema.js";

// Each field message: its English and the code a client renders it from in the user's language.
const WORKSPACE_MEMBERS_FIELD_MESSAGES = deepFreeze({
  inviteTokenRequired: { code: "workspaces.invite.tokenRequired", message: "Invite token is required." },
  inviteTokenInvalid: { code: "workspaces.invite.tokenInvalid", message: "Invite token is invalid." },
  decisionRequired: { code: "workspaces.invite.decisionRequired", message: "Decision is required." },
  decisionInvalid: { code: "workspaces.invite.decisionInvalid", message: "Decision must be accept or refuse." }
});

const workspaceSummaryOutputSchema = createSchema({
  id: { type: "string", required: true, minLength: 1, pattern: RECORD_ID_PATTERN },
  slug: { type: "string", required: true, minLength: 1, maxLength: 120 },
  name: { type: "string", required: true, minLength: 1, maxLength: 160 },
  ownerUserId: { type: "string", required: true, minLength: 1, pattern: RECORD_ID_PATTERN },
  avatarUrl: { type: "string", required: true }
});

const memberSummaryOutputSchema = createSchema({
  userId: { type: "string", required: true, minLength: 1, pattern: RECORD_ID_PATTERN },
  roleSid: { type: "string", required: true, minLength: 1, maxLength: 64 },
  status: { type: "string", required: true, minLength: 1, maxLength: 64 },
  displayName: { type: "string", required: true },
  email: { type: "string", required: true, minLength: 1, maxLength: 255 },
  isOwner: { type: "boolean", required: true }
});

const inviteSummaryOutputSchema = createSchema({
  id: { type: "string", required: true, minLength: 1, pattern: RECORD_ID_PATTERN },
  email: { type: "string", required: true, minLength: 3, maxLength: 255 },
  roleSid: { type: "string", required: true, minLength: 1, maxLength: 64 },
  status: { type: "string", required: true, minLength: 1, maxLength: 64 },
  expiresAt: { type: "string", required: true, minLength: 1 },
  invitedByUserId: { type: "string", required: false, nullable: true, minLength: 1, pattern: RECORD_ID_PATTERN }
});

const workspaceMembersOutputSchema = createSchema({
  workspace: {
    type: "object",
    required: true,
    schema: workspaceSummaryOutputSchema
  },
  members: {
    type: "array",
    required: true,
    items: memberSummaryOutputSchema
  },
  roleCatalog: {
    type: "object",
    required: true,
    schema: workspaceRoleCatalogSchema
  }
});

const workspaceInvitesListOutputSchema = createSchema({
  workspace: {
    type: "object",
    required: true,
    schema: workspaceSummaryOutputSchema
  },
  invites: {
    type: "array",
    required: true,
    items: inviteSummaryOutputSchema
  },
  roleCatalog: {
    type: "object",
    required: true,
    schema: workspaceRoleCatalogSchema
  }
});

const workspaceInviteCreateOutputSchema = createSchema({
  workspace: {
    type: "object",
    required: true,
    schema: workspaceSummaryOutputSchema
  },
  invites: {
    type: "array",
    required: true,
    items: inviteSummaryOutputSchema
  },
  roleCatalog: {
    type: "object",
    required: true,
    schema: workspaceRoleCatalogSchema
  },
  inviteTokenPreview: {
    type: "string",
    required: true,
    minLength: 1
  },
  inviteUrl: {
    type: "string",
    required: true,
    minLength: 1
  },
  inviteDelivery: {
    type: "object",
    required: true,
    schema: createSchema({
      status: {
        type: "string",
        required: true,
        enum: ["sent", "failed", "mailer_unconfigured"]
      },
      message: {
        type: "string",
        required: true
      },
      messageCode: {
        type: "string",
        required: false
      },
      messageParams: {
        type: "object",
        required: false,
        additionalProperties: true
      },
      providerMessageId: {
        type: "string",
        required: true
      }
    })
  },
  createdInviteId: {
    type: "string",
    required: true,
    minLength: 1,
    pattern: RECORD_ID_PATTERN
  }
});

const workspaceInviteRevokeOutputSchema = createSchema({
  workspace: {
    type: "object",
    required: true,
    schema: workspaceSummaryOutputSchema
  },
  invites: {
    type: "array",
    required: true,
    items: inviteSummaryOutputSchema
  },
  roleCatalog: {
    type: "object",
    required: true,
    schema: workspaceRoleCatalogSchema
  },
  revokedInviteId: {
    type: "string",
    required: true,
    minLength: 1,
    pattern: RECORD_ID_PATTERN
  }
});

const updateMemberRoleBodySchema = createSchema({
  roleSid: { type: "string", required: true, minLength: 1, lowercase: true }
});

const updateMemberRoleInputSchema = createSchema({
  memberUserId: { type: "id", required: true },
  roleSid: { type: "string", required: true, minLength: 1, lowercase: true }
});

const removeMemberInputSchema = createSchema({
  memberUserId: { type: "id", required: true }
});

const createInviteBodySchema = createSchema({
  email: { type: "string", required: true, minLength: 3, lowercase: true },
  roleSid: { type: "string", required: true, minLength: 1, lowercase: true }
});

const revokeInviteInputSchema = createSchema({
  inviteId: { type: "id", required: true }
});

const redeemInviteBodySchema = createSchema({
  token: {
    type: "string",
    required: true,
    minLength: 1,
    messages: {
      required: WORKSPACE_MEMBERS_FIELD_MESSAGES.inviteTokenRequired,
      minLength: WORKSPACE_MEMBERS_FIELD_MESSAGES.inviteTokenRequired,
      default: WORKSPACE_MEMBERS_FIELD_MESSAGES.inviteTokenInvalid
    }
  },
  decision: {
    type: "string",
    required: true,
    enum: ["accept", "refuse"],
    messages: {
      required: WORKSPACE_MEMBERS_FIELD_MESSAGES.decisionRequired,
      default: WORKSPACE_MEMBERS_FIELD_MESSAGES.decisionInvalid
    }
  }
});

const redeemInviteOutputSchema = createSchema({
  decision: {
    type: "string",
    required: true,
    enum: ["accepted", "refused"]
  }
});

const workspaceMembersResource = defineResource({
  namespace: "workspaceMembers",
  messages: OPERATION_MESSAGES,
  operations: {
    rolesList: {
      method: "GET",
      output: workspaceRoleCatalogSchema
    },
    membersList: {
      method: "GET",
      output: workspaceMembersOutputSchema
    },
    updateMemberRole: {
      method: "PATCH",
      body: updateMemberRoleBodySchema,
      input: updateMemberRoleInputSchema,
      output: workspaceMembersOutputSchema
    },
    removeMember: {
      method: "DELETE",
      input: removeMemberInputSchema,
      output: workspaceMembersOutputSchema
    },
    invitesList: {
      method: "GET",
      output: workspaceInvitesListOutputSchema
    },
    createInvite: {
      method: "POST",
      body: createInviteBodySchema,
      output: workspaceInviteCreateOutputSchema
    },
    revokeInvite: {
      method: "DELETE",
      input: revokeInviteInputSchema,
      output: workspaceInviteRevokeOutputSchema
    },
    redeemInvite: {
      method: "POST",
      body: redeemInviteBodySchema,
      output: redeemInviteOutputSchema
    }
  }
});

export { workspaceMembersResource };
