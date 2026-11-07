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
  // Given a formId, the page's app bar carries Save: the form takes the id and the card draws no Save of its own.
  assert.match(card, /<v-form :id="props\.formId \|\| undefined"/u);
  assert.match(card, /<div v-if="!props\.formId \|\| !props\.addEdit\.canSave"/u);
});

// Material 3 tonal containers: inside the conversation only the composer, an outlined text field, draws an outline;
// attachments, questions, code, tables, details and the model menu are surface-container tones.
test("the conversation's containers are surface-container tones, not outlined boxes", async () => {
  const folder = new URL("../src/client/conversation/", import.meta.url);
  const files = ["AssistantTranscript.css", "AssistantAttachmentQueue.vue", "AssistantMessageAttachments.vue",
    "AssistantModelControl.vue", "LongTextPreviewBlocks.vue", "LongTextInlineParts.vue", "AssistantPromptInput.vue"];
  const outlines = [];
  for (const file of files) {
    const source = await readFile(new URL(file, folder), "utf8");
    for (const [declaration] of source.matchAll(/\bborder(?:-(?:top|bottom|left|right|inline|block)(?:-(?:start|end))?)?: [^;]*\d[^;]*;/gu)) {
      if (!/: 0;/u.test(declaration)) outlines.push(`${file}: ${declaration}`);
    }
    if (file === "AssistantModelControl.vue") {
      assert.doesNotMatch(source, /<v-sheet[^>]*\n\s*border\n/u, "the model menu has no outline");
      assert.match(source, /color="surface-container"\s+:elevation="2"/u);
    }
  }
  assert.deepEqual(outlines, [
    "AssistantModelControl.vue: border-bottom: 1px solid rgb(var(--v-theme-outline-variant));",
    "AssistantModelControl.vue: border-top: 1px solid rgb(var(--v-theme-outline-variant));",
    "LongTextPreviewBlocks.vue: border-bottom: 1px solid rgb(var(--v-theme-outline-variant));",
    "AssistantPromptInput.vue: border: 1px solid rgb(var(--v-theme-outline));"
  ], "only outline-variant dividers and the composer's outlined field draw lines");
});
