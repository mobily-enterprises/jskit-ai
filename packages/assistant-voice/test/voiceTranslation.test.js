import assert from "node:assert/strict";
import test from "node:test";
import { createI18n } from "vue-i18n";
import { setJskitI18n } from "@jskit-ai/kernel/client";

import { voiceError, voiceErrorText, voiceEventError, voiceSpeechWording } from "../src/client/i18n.js";
import { voiceDaemonError } from "../src/server/voiceDaemon.js";
import { parseVoiceClientControl, speechTextFromAssistant, takeStreamingSpeech } from "../src/shared/protocol.js";

function useTestLanguage(t) {
  const i18n = createI18n({
    legacy: false, locale: "xx", fallbackLocale: "en", missingWarn: false, fallbackWarn: false,
    messages: { xx: { jskit: {
      errors: { voice_utterance_too_long: "XX {seconds}" },
      assistant: { voice: {
        errors: { notConnected: "XX not connected" },
        daemon: { speechFailed: "XX speech failed" },
        speech: { codeOnScreen: "XX code", detailsInChat: "XX details" }
      } }
    } } }
  });
  setJskitI18n(i18n);
  t.after(() => setJskitI18n(null));
}

test("voice errors keep their code and English and carry the fields a browser translates", () => {
  const error = (() => { try { parseVoiceClientControl(JSON.stringify({ type: "listen.start", turnId: "a", sampleRate: 1 })); } catch (cause) { return cause; } })();
  assert.deepEqual(voiceDaemonError(error), {
    code: "voice_input_sample_rate_invalid",
    message: "Voice input must be 16000 Hz mono PCM.",
    params: { sampleRate: 16000 }
  });
  assert.deepEqual(voiceDaemonError(null, { message: "Speech could not be generated.", messageCode: "assistant.voice.daemon.speechFailed" }), {
    code: "voice_operation_failed",
    message: "Speech could not be generated.",
    messageCode: "assistant.voice.daemon.speechFailed",
    messageParams: {}
  });
});

test("without an app language voice text stays English", () => {
  assert.equal(voiceErrorText(voiceError("jskit.assistant.voice.errors.notConnected")), "Voice is not connected.");
  assert.equal(voiceSpeechWording().code, "I put the code on screen.");
  assert.equal(speechTextFromAssistant("```js\nx\n```"), "I put the code on screen.");
});

test("an app language translates voice errors, service events and spoken substitutes", (t) => {
  useTestLanguage(t);
  assert.equal(voiceErrorText(voiceError("jskit.assistant.voice.errors.notConnected")), "XX not connected");
  assert.equal(voiceErrorText(voiceEventError({
    code: "voice_utterance_too_long", params: { seconds: 60 }, message: "Voice recordings are limited to 60 seconds."
  }, "jskit.assistant.voice.errors.couldNotConnect")), "XX 60");
  assert.equal(voiceErrorText(voiceEventError({
    code: "voice_operation_failed", message: "Speech could not be generated.", messageCode: "assistant.voice.daemon.speechFailed"
  }, "jskit.assistant.voice.errors.couldNotConnect")), "XX speech failed");
  // An engine's own sentence under a shared code is shown as sent.
  assert.equal(voiceErrorText(voiceEventError({ code: "voice_operation_failed", message: "Speech worker timed out." },
    "jskit.assistant.voice.errors.couldNotConnect")), "Speech worker timed out.");
  const wording = voiceSpeechWording();
  assert.equal(speechTextFromAssistant("Look:\n```js\nx\n```", undefined, wording), "Look:\nXX code");
  assert.equal(takeStreamingSpeech("| a | b |\n| 1 | 2 |\nNext", false, 140, wording).text, "XX details\n");
});
