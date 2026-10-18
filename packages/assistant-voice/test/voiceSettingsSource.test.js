import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = name => readFile(new URL(`../src/client/${name}`, import.meta.url), "utf8");

test("the speaking-voice selector is one exported component reused by the settings menu", async () => {
  const [select, settings, index] = await Promise.all([
    source("VoiceSpeakingVoiceSelect.vue"), source("VoiceConversationSettings.vue"), source("index.js")
  ]);
  assert.match(select, /label="Speaking voice"/u);
  assert.match(select, /selectedVoice\.value = value/u);
  assert.match(settings, /<VoiceSpeakingVoiceSelect v-if="voice" :voice="voice" \/>/u);
  assert.doesNotMatch(settings, /label="Speaking voice"/u);
  assert.match(index, /export \{ default as VoiceSpeakingVoiceSelect \} from "\.\/VoiceSpeakingVoiceSelect\.vue";/u);
});
