import assert from "node:assert/strict";
import test from "node:test";

import { createApi } from "../src/shared/workspaceTranscriptsApi.js";

test("workspaceTranscriptsApi uses workspace transcript routes", async () => {
  const calls = [];
  const api = createApi({
    request: async (url) => {
      calls.push(url);
      return { ok: true };
    }
  });

  assert.deepEqual(Object.keys(api), ["listAiTranscripts", "getAiTranscriptMessages", "exportAiTranscript"]);

  await api.listAiTranscripts({ page: 2, pageSize: 25, status: "completed", createdByUserId: 42 });
  await api.getAiTranscriptMessages("conv/1", { page: 1, pageSize: 200 });
  await api.exportAiTranscript("conv/1", { format: "json", limit: 10 });

  assert.equal(calls[0], "/api/v1/admin/workspace/ai/transcripts?page=2&pageSize=25&status=completed&createdByUserId=42");
  assert.equal(calls[1], "/api/v1/admin/workspace/ai/transcripts/conv%2F1/messages?page=1&pageSize=200");
  assert.equal(calls[2], "/api/v1/admin/workspace/ai/transcripts/conv%2F1/export?limit=10&format=json");
});
