import {
  RECORD_ID_PATTERN
} from "@jskit-ai/kernel/shared/validators";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { createOperationMessages } from "../operationMessages.js";
import { createSchema } from "json-rest-schema";
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

const workspaceRoleCatalogOutputValidator = deepFreeze({
  schema: workspaceRoleCatalogSchema,
  mode: "replace"
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

const workspaceMembersOutputValidator = deepFreeze({
  schema: workspaceMembersOutputSchema,
  mode: "replace"
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

const workspaceInvitesOutputValidator = deepFreeze({
  schema: workspaceInvitesListOutputSchema,
  mode: "replace"
});

const workspaceInviteCreateOutputValidator = deepFreeze({
  schema: createSchema({
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
  }),
  mode: "replace"
});

const workspaceInviteRevokeOutputValidator = deepFreeze({
  schema: createSchema({
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
  }),
  mode: "replace"
});

const updateMemberRoleBodyValidator = deepFreeze({
  schema: createSchema({
    roleSid: { type: "string", required: true, minLength: 1, lowercase: true }
  }),
  mode: "patch"
});

const updateMemberRoleInputValidator = deepFreeze({
  schema: createSchema({
    memberUserId: { type: "id", required: true },
    roleSid: { type: "string", required: true, minLength: 1, lowercase: true }
  }),
  mode: "patch"
});

const removeMemberInputValidator = deepFreeze({
  schema: createSchema({
    memberUserId: { type: "id", required: true }
  }),
  mode: "patch"
});

const createInviteBodyValidator = deepFreeze({
  schema: createSchema({
    email: { type: "string", required: true, minLength: 3, lowercase: true },
    roleSid: { type: "string", required: true, minLength: 1, lowercase: true }
  }),
  mode: "create"
});

const revokeInviteInputValidator = deepFreeze({
  schema: createSchema({
    inviteId: { type: "id", required: true }
  }),
  mode: "patch"
});

const redeemInviteBodyValidator = deepFreeze({
  schema: createSchema({
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
  }),
  mode: "create"
});

const redeemInviteOutputValidator = deepFreeze({
  schema: createSchema({
    decision: {
      type: "string",
      required: true,
      enum: ["accepted", "refused"]
    }
  }),
  mode: "replace"
});

const WORKSPACE_MEMBERS_MESSAGES = createOperationMessages();

const workspaceMembersResource = deepFreeze({
  namespace: "workspaceMembers",
  messages: WORKSPACE_MEMBERS_MESSAGES,
  operations: {
    rolesList: {
      method: "GET",
      messages: WORKSPACE_MEMBERS_MESSAGES,
      output: workspaceRoleCatalogOutputValidator
    },
    membersList: {
      method: "GET",
      messages: WORKSPACE_MEMBERS_MESSAGES,
      output: workspaceMembersOutputValidator
    },
    updateMemberRole: {
      method: "PATCH",
      messages: WORKSPACE_MEMBERS_MESSAGES,
      body: updateMemberRoleBodyValidator,
      input: updateMemberRoleInputValidator,
      output: workspaceMembersOutputValidator
    },
    removeMember: {
      method: "DELETE",
      messages: WORKSPACE_MEMBERS_MESSAGES,
      input: removeMemberInputValidator,
      output: workspaceMembersOutputValidator
    },
    invitesList: {
      method: "GET",
      messages: WORKSPACE_MEMBERS_MESSAGES,
      output: workspaceInvitesOutputValidator
    },
    createInvite: {
      method: "POST",
      messages: WORKSPACE_MEMBERS_MESSAGES,
      body: createInviteBodyValidator,
      output: workspaceInviteCreateOutputValidator
    },
    revokeInvite: {
      method: "DELETE",
      messages: WORKSPACE_MEMBERS_MESSAGES,
      input: revokeInviteInputValidator,
      output: workspaceInviteRevokeOutputValidator
    },
    redeemInvite: {
      method: "POST",
      messages: WORKSPACE_MEMBERS_MESSAGES,
      body: redeemInviteBodyValidator,
      output: redeemInviteOutputValidator
    }
  }
});

export { workspaceMembersResource };
