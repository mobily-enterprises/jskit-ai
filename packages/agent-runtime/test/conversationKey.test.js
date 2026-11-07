import assert from "node:assert/strict";
import test from "node:test";
import { createCommandsRepository } from "../src/server/repositories/commandsRepository.js";
import { createGoalsRepository } from "../src/server/repositories/goalsRepository.js";
import { createRunsRepository } from "../src/server/repositories/runsRepository.js";
import { createSummariesRepository } from "../src/server/repositories/summariesRepository.js";

// A handle that records every call, so a refused call can be seen to reach no table.
function recordingHandle(calls) {
  return new Proxy({}, {
    get(_target, method) {
      return (...args) => {
        calls.push(method);
        return method === "raw" ? { sql: args[0] } : Promise.resolve({ records: [] });
      };
    }
  });
}

test("every agent store call on one conversation refuses a missing conversation id before any statement", async () => {
  const calls = [];
  const handle = recordingHandle(calls);
  const options = Object.freeze({ context: {} });
  const goals = createGoalsRepository({ goals: handle, options });
  const commands = createCommandsRepository({ commands: handle, options });
  const summaries = createSummariesRepository({ summaries: handle, queue: handle, options });
  const runs = createRunsRepository({ runs: handle, options });

  for (const conversationId of [undefined, null, ""]) {
    for (const call of [
      () => goals.open(conversationId),
      () => goals.active(conversationId),
      () => goals.resumePaused(conversationId),
      () => commands.find(conversationId, "1"),
      () => commands.start({ conversationId, script: "true", server: "a" }),
      () => summaries.latest(conversationId),
      () => summaries.saveUnlessNewer(conversationId, { coversUpTo: 1, summary: "s", messages: 1 }, 2),
      () => summaries.enqueue(conversationId),
      () => summaries.dequeue(conversationId),
      () => summaries.retryLater(conversationId, { attempts: 1, lastError: "e", waitSeconds: 60 }),
      () => runs.insert(conversationId, {}),
      () => runs.takeOver(conversationId, 60),
      () => runs.saved(conversationId),
      () => runs.heartbeat(conversationId),
      () => runs.save(conversationId, [], {}),
      () => runs.release(conversationId)
    ]) {
      await assert.rejects(async () => call(), /needs the conversation's id/u);
    }
  }
  assert.deepEqual(calls.filter((method) => method !== "raw"), []);
});
