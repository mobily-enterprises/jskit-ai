import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";

// The assistant's four tables. The repositories normalize every value before
// they write it, so text is stored exactly as given (noTrim), and dates are
// written as UTC database date-times. Each declares the foreign keys its
// migrations always create; the workspace_id keys exist only where the
// application has a workspaces table (constraints/assistant_workspaces_foreign_keys.cjs),
// so none declares them.

/** @param {Record<string, unknown>} [definition] */
function textField(definition = {}) {
  return { type: "string", noTrim: true, ...definition };
}

/** @param {Record<string, unknown>} [definition] */
function dateTimeField(definition = {}) {
  return { type: "dateTime", storage: { writeSerializer: "datetime-utc" }, ...definition };
}

// A surface's saved settings: one row per surface and scope. Global settings
// (workspaceId null) are shared by every workspace.
const assistantConfigResource = defineTableResource({
  name: "assistantConfig",
  tableName: "assistant_config",
  ownership: "workspace_or_shared",
  schema: {
    targetSurfaceId: textField({ search: true }),
    scopeKey: textField({ search: true }),
    workspaceId: { type: "id", nullable: true, search: true },
    systemPrompt: textField(),
    createdAt: dateTimeField(),
    updatedAt: dateTimeField()
  }
});

// A conversation belongs to the user who started it (created_by_user_id); its
// workspace (null for a global surface) and surface are filters of its actor scope.
const assistantConversationsResource = defineTableResource({
  name: "assistantConversations",
  tableName: "assistant_conversations",
  ownership: "user",
  foreignKeys: [{ columns: ["userId"], referencedTableName: "users" }],
  queryMaxLimit: 200,
  schema: {
    workspaceId: { type: "id", nullable: true, search: true },
    userId: { type: "id", nullable: true, search: true, storage: { column: "created_by_user_id" } },
    title: textField(),
    status: textField({ search: true }),
    provider: textField(),
    model: textField(),
    surfaceId: textField({ search: true }),
    messageCount: { type: "integer" },
    metadataJson: textField({ nullable: true }),
    startedAt: dateTimeField(),
    endedAt: dateTimeField({ nullable: true }),
    createdAt: dateTimeField(),
    updatedAt: dateTimeField(),
    summaryText: textField({ nullable: true }),
    summaryThroughTurnId: textField({ nullable: true }),
    transcriptRevision: textField({ nullable: true })
  },
  searchSchema: {
    beforeId: { type: "id", actualField: "id", filterOperator: "<" }
  }
});

// A conversation's messages, in seq order, with the conversation's workspace.
const assistantMessagesResource = defineTableResource({
  name: "assistantMessages",
  tableName: "assistant_messages",
  ownership: "workspace",
  foreignKeys: [
    { columns: ["conversationId"], referencedTableName: "assistant_conversations" },
    { columns: ["actorUserId"], referencedTableName: "users" }
  ],
  queryMaxLimit: 500,
  schema: {
    conversationId: { type: "id", search: true },
    workspaceId: { type: "id", nullable: true, search: true },
    seq: { type: "integer" },
    role: textField({ search: true }),
    kind: textField({ search: true }),
    clientMessageSid: textField(),
    actorUserId: { type: "id", nullable: true },
    contentText: textField({ nullable: true }),
    metadataJson: textField({ nullable: true }),
    createdAt: dateTimeField()
  },
  searchSchema: {
    conversationIds: { type: "array", actualField: "conversationId", filterOperator: "in", items: { type: "string" } }
  }
});

// The receipt of one chat request, keyed by its actor, surface and workspace
// scope, and the client's message id.
const assistantTurnRequestsResource = defineTableResource({
  name: "assistantTurnRequests",
  tableName: "assistant_turn_requests",
  ownership: "user",
  foreignKeys: [{ columns: ["userId"], referencedTableName: "users" }],
  schema: {
    userId: { type: "id", search: true, storage: { column: "actor_user_id" } },
    scopeKey: textField({ search: true }),
    messageSid: textField({ search: true }),
    claimToken: textField(),
    requestJson: textField(),
    responseJson: textField({ nullable: true }),
    status: textField(),
    createdAt: dateTimeField(),
    updatedAt: dateTimeField()
  }
});

export {
  assistantConfigResource,
  assistantConversationsResource,
  assistantMessagesResource,
  assistantTurnRequestsResource
};
