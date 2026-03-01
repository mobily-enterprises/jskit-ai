import test from "node:test";
import assert from "node:assert/strict";
import {
  WORKSPACE_AI_TRANSCRIPTS_QUERY_KEY_PREFIX,
  workspaceAiTranscriptMessagesQueryKey,
  workspaceAiTranscriptsListQueryKey,
  workspaceAiTranscriptsRootQueryKey,
  workspaceAiTranscriptsScopeQueryKey
} from "../src/lib/transcriptQueryKeys.js";

test("transcript query keys normalize workspace, status, actor filter, and paging", () => {
  assert.deepEqual(WORKSPACE_AI_TRANSCRIPTS_QUERY_KEY_PREFIX, ["workspace-ai-transcripts"]);
  assert.deepEqual(workspaceAiTranscriptsRootQueryKey(), ["workspace-ai-transcripts"]);
  assert.deepEqual(workspaceAiTranscriptsScopeQueryKey(" acme "), ["workspace-ai-transcripts", "acme"]);
  assert.deepEqual(workspaceAiTranscriptsScopeQueryKey(""), ["workspace-ai-transcripts", "none"]);

  assert.deepEqual(workspaceAiTranscriptsListQueryKey("acme"), ["workspace-ai-transcripts", "acme", "list", 1, 20, "all", "all"]);
  assert.deepEqual(
    workspaceAiTranscriptsListQueryKey("acme", {
      page: "2",
      pageSize: "10",
      status: "ACTIVE",
      createdByUserId: "5"
    }),
    ["workspace-ai-transcripts", "acme", "list", 2, 10, "active", "5"]
  );

  assert.deepEqual(workspaceAiTranscriptMessagesQueryKey("acme", 17), [
    "workspace-ai-transcripts",
    "acme",
    "conversation",
    "17",
    "messages",
    1,
    500
  ]);
  assert.deepEqual(workspaceAiTranscriptMessagesQueryKey("acme", "bad", { page: 0, pageSize: 0 }), [
    "workspace-ai-transcripts",
    "acme",
    "conversation",
    "none",
    "messages",
    1,
    500
  ]);
});
