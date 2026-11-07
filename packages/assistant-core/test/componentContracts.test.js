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

// Material 3: one container at most, the composer an outlined text field, and no heading inside a titled pane.
test("the transcript, composer and settings card each draw one Material 3 container", async () => {
  const transcript = await readFile(new URL("../src/client/conversation/AssistantTranscript.css", import.meta.url), "utf8");
  const block = (css, selector) => new RegExp(`(?:^|\\n)${selector.replaceAll(".", "\\.")} \\{([^}]*)\\}`, "u").exec(css)?.[1] ?? "";
  assert.doesNotMatch(block(transcript, ".assistant-transcript"), /border/u, "the transcript area is not outlined");
  assert.doesNotMatch(block(transcript, ".assistant-transcript__welcome"), /\bborder:/u, "the welcome bubble is a tonal fill only");
  const prompt = await readFile(new URL("../src/client/conversation/AssistantPromptInput.vue", import.meta.url), "utf8");
  const field = block(prompt, ".assistant-prompt-input__field");
  assert.match(field, /border: 1px solid rgb\(var\(--v-theme-outline\)\);/u);
  assert.match(field, /border-radius: 4px;/u);
  assert.match(block(prompt, ".assistant-prompt-input__footer"), /padding: 0 12px 12px;/u);
  const card = await readFile(new URL("../src/client/components/AssistantSettingsFormCard.vue", import.meta.url), "utf8");
  assert.doesNotMatch(card, /<v-card-title|<v-card-subtitle|<v-divider/u);
  assert.match(card, /:aria-label="props\.title"/u);
});
