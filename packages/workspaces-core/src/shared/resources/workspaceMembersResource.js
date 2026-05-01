import { RECORD_ID_PATTERN } from "@jskit-ai/kernel/shared/validators";
import { createSchema } from "json-rest-schema";
import { defineResource } from "@jskit-ai/resource-core/shared/resource";
import { createOperationMessages } from "../operationMessages.js";
import { workspaceRoleCatalogSchema } from "./workspaceRoleCatalogSchema.js";

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
      required: "Invite token is required.",
      minLength: "Invite token is required.",
      default: "Invite token is invalid."
    }
  },
  decision: {
    type: "string",
    required: true,
    enum: ["accept", "refuse"],
    messages: {
      required: "Decision is required.",
      default: "Decision must be accept or refuse."
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
  messages: createOperationMessages(),
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
