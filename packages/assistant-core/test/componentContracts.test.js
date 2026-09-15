import assert from "node:assert/strict";
import test from "node:test";
import { readFile, access } from "node:fs/promises";

test("client entry points expose one conversation implementation and retain settings/API helpers", async () => {
  const source = await readFile(new URL("../src/client/index.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /AssistantClientElement/);
  assert.match(source, /AssistantSettingsFormCard/);
  assert.match(source, /createAssistantApi/);
  await assert.rejects(access(new URL("../src/client/components/AssistantClientElement.vue", import.meta.url)));
  const conversation = await readFile(new URL("../src/client/conversation/index.js", import.meta.url), "utf8");
  assert.match(conversation, /AssistantConversationElement/);
});
