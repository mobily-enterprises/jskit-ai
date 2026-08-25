import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/vue-query";

import { assistantConversationMessagesQueryKey } from "@jskit-ai/assistant-core/shared";
import {
  loadConversationTranscript,
  resolveConversationRestorePolicy
} from "../src/client/support/conversationRestoreSupport.js";

test("conversation restore includes completed replies beyond the first transcript page", async () => {
  const requests = [];
  const pages = new Map([
    [1, {
      total: 201,
      totalPages: 2,
      entries: [
        { id: "199", role: "assistant", kind: "tool_result" },
        { id: "200", role: "user", kind: "chat", contentText: "What is happening today?" }
      ]
    }],
    [2, {
      total: 201,
      totalPages: 2,
      entries: [
        { id: "201", role: "assistant", kind: "chat", contentText: "There are 17 bookings today." }
      ]
    }]
  ]);

  const transcript = await loadConversationTranscript({
    async fetchPage(page, pageSize) {
      requests.push({ page, pageSize });
      return pages.get(page);
    }
  });

  assert.deepEqual(requests, [
    { page: 1, pageSize: 200 },
    { page: 2, pageSize: 200 }
  ]);
  assert.deepEqual(transcript.entries.map((entry) => entry.id), ["199", "200", "201"]);
  assert.equal(transcript.entries.at(-1).contentText, "There are 17 bookings today.");
  assert.equal(transcript.truncated, false);
});

test("conversation restore keeps the newest bounded transcript pages", async () => {
  const requests = [];
  const pages = new Map([
    [1, { total: 12, totalPages: 6, entries: [{ id: "1" }, { id: "2" }] }],
    [5, { total: 12, totalPages: 6, entries: [{ id: "9" }, { id: "10" }] }],
    [6, { total: 12, totalPages: 6, entries: [{ id: "11" }, { id: "12" }] }]
  ]);

  const transcript = await loadConversationTranscript({
    pageSize: 2,
    maxEntries: 4,
    async fetchPage(page) {
      requests.push(page);
      return pages.get(page);
    }
  });

  assert.deepEqual(requests, [1, 5, 6]);
  assert.deepEqual(transcript.entries.map((entry) => entry.id), ["9", "10", "11", "12"]);
  assert.equal(transcript.firstRestoredPage, 5);
  assert.equal(transcript.truncated, true);
});

test("conversation restore reuses every cached transcript page after remount", async () => {
  const backendRequests = [];
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 60_000
      }
    }
  });
  const scope = { targetSurfaceId: "admin", workspaceId: "7" };
  const pages = new Map([
    [1, { total: 201, totalPages: 2, entries: [{ id: "200" }] }],
    [2, { total: 201, totalPages: 2, entries: [{ id: "201" }] }]
  ]);
  const fetchPage = (page, pageSize) => queryClient.fetchQuery({
    queryKey: assistantConversationMessagesQueryKey(scope, "41", { page, pageSize }),
    queryFn: async () => {
      backendRequests.push(page);
      return pages.get(page);
    },
    staleTime: 60_000
  });

  const firstRestore = await loadConversationTranscript({ fetchPage });
  const warmRestore = await loadConversationTranscript({ fetchPage });

  assert.deepEqual(firstRestore.entries.map((entry) => entry.id), ["200", "201"]);
  assert.deepEqual(warmRestore.entries.map((entry) => entry.id), ["200", "201"]);
  assert.deepEqual(backendRequests, [1, 2]);
});

test("conversation restore policy caps page and transcript sizes", () => {
  assert.deepEqual(resolveConversationRestorePolicy({
    pageSize: 100_000,
    maxEntries: 100_000
  }), {
    pageSize: 500,
    maxEntries: 5000
  });
});
