import test from "node:test";
import assert from "node:assert/strict";
import { createService, __testables } from "../src/shared/service.js";

function buildService({
  transcriptMode = "disabled",
  conversationsRepository = null,
  messagesRepository = null
} = {}) {
  return createService({
    conversationsRepository: conversationsRepository || {
      async insert() {
        return { id: 1, transcriptMode, status: "active", workspaceId: 20 };
      },
      async findById() {
        return null;
      },
      async updateById() {
        return null;
      },
      async findByIdForWorkspace() {
        return null;
      },
      async count() {
        return 0;
      },
      async list() {
        return [];
      },
      async incrementMessageCount() {},
      async findByIdForWorkspaceAndUser() {
        return null;
      }
    },
    messagesRepository: messagesRepository || {
      async insert() {
        return { id: 1 };
      },
      async listByConversationId() {
        return [];
      },
      async countByConversationId() {
        return 0;
      },
      async listByConversationIdForWorkspace() {
        return [];
      },
      async countByConversationIdForWorkspace() {
        return 0;
      },
      async exportByFilters() {
        return [];
      }
    },
    workspaceSettingsRepository: {
      async ensureForWorkspaceId() {
        return {
          features: {
            ai: {
              transcriptMode
            }
          }
        };
      }
    },
    consoleMembershipsRepository: {
      async findByUserId() {
        return { status: "active", roleId: "devop" };
      }
    },
    hasPermissionFn(permissions, permission) {
      return Array.isArray(permissions) && permissions.includes(permission);
    },
    resolveRolePermissionsFn() {
      return ["console.ai.transcripts.read_all", "console.ai.transcripts.export_all"];
    },
    consoleReadPermission: "console.ai.transcripts.read_all",
    consoleExportPermission: "console.ai.transcripts.export_all"
  });
}

test("startConversationForTurn returns null conversation when transcript mode is disabled", async () => {
  const service = buildService({ transcriptMode: "disabled" });
  const result = await service.startConversationForTurn({
    workspace: { id: 12 },
    user: { id: 5 },
    messageId: "m_1",
    provider: "openai",
    model: "gpt-4.1-mini"
  });

  assert.equal(result.conversation, null);
  assert.equal(result.transcriptMode, "disabled");
});

test("preparePersistedContent stores only metadata in restricted mode", () => {
  const prepared = __testables.preparePersistedContent("token=abc", "restricted");
  assert.equal(prepared.contentText, null);
  assert.equal(prepared.redactionHits.restricted, true);
  assert.ok(prepared.messageMetadata.contentDigest);
});
