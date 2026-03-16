import test from "node:test";
import assert from "node:assert/strict";
import { createTranscriptService } from "../src/server/services/transcriptService.js";

function createInMemoryTranscriptRepos({
  initialTitle = "New conversation"
} = {}) {
  const state = {
    nextConversationId: 1,
    nextMessageId: 1,
    conversations: new Map(),
    updateCalls: []
  };

  const conversationsRepository = {
    async findById(conversationId) {
      return state.conversations.get(Number(conversationId)) || null;
    },
    async findByIdForWorkspaceAndUser(conversationId, workspaceId, actorUserId) {
      const conversation = state.conversations.get(Number(conversationId)) || null;
      if (!conversation) {
        return null;
      }
      if (Number(conversation.workspaceId) !== Number(workspaceId)) {
        return null;
      }
      if (Number(conversation.createdByUserId) !== Number(actorUserId)) {
        return null;
      }
      return conversation;
    },
    async create(payload) {
      const id = state.nextConversationId;
      state.nextConversationId += 1;
      const created = {
        id,
        workspaceId: Number(payload.workspaceId),
        createdByUserId: Number(payload.createdByUserId),
        title: String(payload.title || initialTitle),
        status: String(payload.status || "active"),
        provider: String(payload.provider || ""),
        model: String(payload.model || ""),
        surfaceId: String(payload.surfaceId || "admin"),
        messageCount: Number(payload.messageCount || 0),
        metadata: payload.metadata || {}
      };
      state.conversations.set(id, created);
      return created;
    },
    async updateById(conversationId, patch = {}) {
      const id = Number(conversationId);
      const existing = state.conversations.get(id) || null;
      if (!existing) {
        return null;
      }
      state.updateCalls.push({
        id,
        patch: { ...patch }
      });
      const nextConversation = {
        ...existing,
        ...patch
      };
      state.conversations.set(id, nextConversation);
      return nextConversation;
    },
    async incrementMessageCount(conversationId, delta = 1) {
      const id = Number(conversationId);
      const existing = state.conversations.get(id) || null;
      if (!existing) {
        return null;
      }
      const nextConversation = {
        ...existing,
        messageCount: Math.max(0, Number(existing.messageCount || 0) + Number(delta || 0))
      };
      state.conversations.set(id, nextConversation);
      return nextConversation;
    }
  };

  const messagesRepository = {
    async create(payload) {
      const id = state.nextMessageId;
      state.nextMessageId += 1;
      return {
        id,
        ...payload
      };
    }
  };

  return {
    state,
    conversationsRepository,
    messagesRepository
  };
}

test("transcriptService sets conversation title from first user chat message", async () => {
  const repos = createInMemoryTranscriptRepos();
  const service = createTranscriptService({
    conversationsRepository: repos.conversationsRepository,
    messagesRepository: repos.messagesRepository
  });

  const created = await service.createConversationForTurn(
    { id: 1 },
    { id: 7 },
    {
      provider: "deepseek",
      model: "deepseek-chat"
    }
  );

  assert.equal(created.created, true);
  assert.equal(created.conversation.title, "New conversation");

  await service.appendMessage(
    created.conversation.id,
    {
      role: "user",
      kind: "chat",
      contentText: "   Rename workspace to acme corp before Friday   "
    },
    {
      context: {
        actor: { id: 7 }
      }
    }
  );

  const updated = repos.state.conversations.get(created.conversation.id);
  assert.equal(updated.title, "Rename workspace to acme corp before Friday");
  assert.equal(repos.state.updateCalls.length, 1);
  assert.deepEqual(repos.state.updateCalls[0].patch, {
    title: "Rename workspace to acme corp before Friday"
  });
});

test("transcriptService does not overwrite existing custom conversation title", async () => {
  const repos = createInMemoryTranscriptRepos({
    initialTitle: "Investigate payment retries"
  });
  const service = createTranscriptService({
    conversationsRepository: repos.conversationsRepository,
    messagesRepository: repos.messagesRepository
  });

  const created = await service.createConversationForTurn(
    { id: 1 },
    { id: 7 },
    {
      title: "Investigate payment retries"
    }
  );

  await service.appendMessage(
    created.conversation.id,
    {
      role: "user",
      kind: "chat",
      contentText: "Change title attempt should not happen."
    },
    {
      context: {
        actor: { id: 7 }
      }
    }
  );

  const updated = repos.state.conversations.get(created.conversation.id);
  assert.equal(updated.title, "Investigate payment retries");
  assert.equal(repos.state.updateCalls.length, 0);
});
