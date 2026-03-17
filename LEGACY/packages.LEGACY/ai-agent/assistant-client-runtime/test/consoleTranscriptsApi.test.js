import assert from "node:assert/strict";
import test from "node:test";

import { createApi } from "../src/lib/consoleTranscriptsApi.js";

test("consoleTranscriptsApi uses console transcript routes", async () => {
  const calls = [];
  const api = createApi({
    request: async (url) => {
      calls.push(url);
      return { ok: true };
    }
  });

  assert.deepEqual(Object.keys(api), ["listAiTranscripts", "getAiTranscriptMessages", "exportAiTranscripts"]);

  await api.listAiTranscripts({ page: 3, pageSize: 10, workspaceId: 12, status: "failed" });
  await api.getAiTranscriptMessages("conv/2", { page: 1, pageSize: 50 });
  await api.exportAiTranscripts({ workspaceId: 12, role: "assistant", format: "csv" });

  assert.equal(calls[0], "/api/console/ai/transcripts?page=3&pageSize=10&workspaceId=12&status=failed");
  assert.equal(calls[1], "/api/console/ai/transcripts/conv%2F2/messages?page=1&pageSize=50");
  assert.equal(calls[2], "/api/console/ai/transcripts/export?workspaceId=12&role=assistant&format=csv");
});
