import assert from "node:assert/strict";
import test from "node:test";

import { createService as createAiTranscriptsService } from "../server/modules/ai/transcripts/service.js";

function createDependencies(overrides = {}) {
  const calls = {
    countFilters: [],
    listFilters: [],
    listPagination: [],
    countMessages: 0,
    listMessages: 0
  };

  const conversationsRepository = {
    async insert(payload) {
      return {
        id: 91,
        workspaceId: payload.workspaceId,
        createdByUserId: payload.createdByUserId,
        status: payload.status || "active",
        transcriptMode: payload.transcriptMode || "standard",
        metadata: payload.metadata || {}
      };
    },
    async findById() {
      return null;
    },
    async findByIdForWorkspace() {
      return null;
    },
    async findByIdForWorkspaceAndUser() {
      return null;
    },
    async updateById(conversationId, patch) {
      return {
        id: conversationId,
        workspaceId: 11,
        createdByUserId: 7,
        status: patch.status || "active",
        transcriptMode: patch.transcriptMode || "standard",
        metadata: patch.metadata || {}
      };
    },
    async incrementMessageCount() {
      return null;
    },
    async list(filters, pagination) {
      calls.listFilters.push(filters);
      calls.listPagination.push(pagination);
      return [];
    },
    async count(filters) {
      calls.countFilters.push(filters);
      return 0;
    }
  };

  const messagesRepository = {
    async insert() {
      return {
        id: 1
      };
    },
    async listByConversationId() {
      return [];
    },
    async listByConversationIdForWorkspace() {
      calls.listMessages += 1;
      return [];
    },
    async countByConversationId() {
      return 0;
    },
    async countByConversationIdForWorkspace() {
      calls.countMessages += 1;
      return 0;
    },
    async exportByFilters() {
      return [];
    }
  };

  const workspaceSettingsRepository = {
    async ensureForWorkspaceId() {
      return {
        assistantTranscriptMode: "standard"
      };
    }
  };

  const consoleMembershipsRepository = {
    async findByUserId() {
      return null;
    }
  };

  const service = createAiTranscriptsService({
    conversationsRepository: {
      ...conversationsRepository,
      ...(overrides.conversationsRepository || {})
    },
    messagesRepository: {
      ...messagesRepository,
      ...(overrides.messagesRepository || {})
    },
    workspaceSettingsRepository: {
      ...workspaceSettingsRepository,
      ...(overrides.workspaceSettingsRepository || {})
    },
    consoleMembershipsRepository: {
      ...consoleMembershipsRepository,
      ...(overrides.consoleMembershipsRepository || {})
    }
  });

  return {
    service,
    calls
  };
}

test("ai transcripts service cannot resume another user's conversation id", async () => {
  const { service } = createDependencies({
    conversationsRepository: {
      async findByIdForWorkspaceAndUser() {
        return null;
      }
    }
  });

  await assert.rejects(
    () =>
      service.startConversationForTurn({
        workspace: { id: 11 },
        user: { id: 7 },
        conversationId: 55,
        messageId: "msg_1",
        provider: "openai",
        model: "gpt-4.1-mini"
      }),
    (error) => {
      assert.equal(error.status, 404);
      assert.equal(error.message, "Conversation not found.");
      return true;
    }
  );
});

test("ai transcripts service creates new conversation with default title and supports title updates", async () => {
  const insertedPayloads = [];
  const updatedPayloads = [];
  const { service } = createDependencies({
    conversationsRepository: {
      async insert(payload) {
        insertedPayloads.push(payload);
        return {
          id: 91,
          workspaceId: payload.workspaceId,
          createdByUserId: payload.createdByUserId,
          title: payload.title,
          status: payload.status || "active",
          transcriptMode: payload.transcriptMode || "standard",
          metadata: payload.metadata || {}
        };
      },
      async updateById(conversationId, patch) {
        updatedPayloads.push({
          conversationId,
          patch
        });
        return {
          id: conversationId,
          workspaceId: 11,
          createdByUserId: 7,
          title: patch.title,
          status: "active",
          transcriptMode: "standard",
          metadata: {}
        };
      }
    }
  });

  const started = await service.startConversationForTurn({
    workspace: { id: 11 },
    user: { id: 7 },
    messageId: "msg_1",
    provider: "openai",
    model: "gpt-4.1-mini"
  });

  assert.equal(insertedPayloads.length, 1);
  assert.equal(insertedPayloads[0].title, "New conversation");
  assert.equal(started.conversation?.title, "New conversation");

  const updated = await service.updateConversationTitle(started.conversation, "Rename workspace");
  assert.equal(updatedPayloads.length, 1);
  assert.equal(updatedPayloads[0].conversationId, 91);
  assert.equal(updatedPayloads[0].patch.title, "Rename workspace");
  assert.equal(updated?.title, "Rename workspace");
});

test("ai transcripts service lists workspace conversations scoped to current owner", async () => {
  const { service, calls } = createDependencies({
    conversationsRepository: {
      async count(filters) {
        calls.countFilters.push(filters);
        return 1;
      },
      async list(filters, pagination) {
        calls.listFilters.push(filters);
        calls.listPagination.push(pagination);
        return [
          {
            id: 71,
            workspaceId: 11,
            createdByUserId: 7,
            status: "completed",
            transcriptMode: "standard",
            provider: "openai",
            model: "gpt-4.1-mini",
            startedAt: "2026-02-20T00:00:00.000Z",
            endedAt: "2026-02-20T00:01:00.000Z",
            messageCount: 2,
            metadata: {},
            createdAt: "2026-02-20T00:00:00.000Z",
            updatedAt: "2026-02-20T00:01:00.000Z",
            workspaceSlug: "acme",
            workspaceName: "Acme"
          }
        ];
      }
    }
  });

  const response = await service.listWorkspaceConversationsForUser(
    { id: 11 },
    { id: 7 },
    { page: 2, pageSize: 25, status: "completed" }
  );

  assert.equal(response.total, 1);
  assert.equal(response.entries.length, 1);
  assert.equal(calls.countFilters[0].workspaceId, 11);
  assert.equal(calls.countFilters[0].createdByUserId, 7);
  assert.equal(calls.countFilters[0].status, "completed");
  assert.equal(calls.listFilters[0].workspaceId, 11);
  assert.equal(calls.listFilters[0].createdByUserId, 7);
  assert.equal(calls.listPagination[0].page, 1);
  assert.equal(calls.listPagination[0].pageSize, 25);
});

test("ai transcripts service applies optional createdByUserId filter for workspace-wide transcript list", async () => {
  const { service, calls } = createDependencies({
    conversationsRepository: {
      async count(filters) {
        calls.countFilters.push(filters);
        return 0;
      },
      async list(filters, pagination) {
        calls.listFilters.push(filters);
        calls.listPagination.push(pagination);
        return [];
      }
    }
  });

  const response = await service.listWorkspaceConversations(
    { id: 11 },
    {
      page: 1,
      pageSize: 20,
      createdByUserId: "42"
    }
  );

  assert.equal(response.total, 0);
  assert.equal(calls.countFilters[0].workspaceId, 11);
  assert.equal(calls.countFilters[0].createdByUserId, 42);
  assert.equal(calls.listFilters[0].workspaceId, 11);
  assert.equal(calls.listFilters[0].createdByUserId, 42);
});

test("ai transcripts service rejects foreign conversation id for user-scoped messages endpoint", async () => {
  const { service, calls } = createDependencies({
    conversationsRepository: {
      async findByIdForWorkspaceAndUser() {
        return null;
      }
    }
  });

  await assert.rejects(
    () =>
      service.getWorkspaceConversationMessagesForUser(
        { id: 11 },
        { id: 7 },
        99,
        {
          page: 1,
          pageSize: 100
        }
      ),
    (error) => {
      assert.equal(error.status, 404);
      assert.equal(error.message, "Conversation not found.");
      return true;
    }
  );

  assert.equal(calls.countMessages, 0);
  assert.equal(calls.listMessages, 0);
});
