import { registerJskitMessages, useJskitText } from "@jskit-ai/kernel/client";
import { catalogMessage, formatMessage } from "@jskit-ai/kernel/shared/i18n";
import en from "../../locales/en.json" with { type: "json" };

registerJskitMessages(en);

const { errorMessage, t } = useJskitText();

// A failure made in the browser keeps its English message for callers and logs, and
// names its sentence so a screen can show it in the active language.
function voiceError(key, params = {}) {
  return Object.assign(new Error(formatMessage(catalogMessage(en, key), params)), {
    messageCode: key.slice("jskit.".length),
    messageParams: params
  });
}

// An error event from the voice service, kept with its code and translation fields.
function voiceEventError(event, fallbackKey) {
  if (!event?.message) return voiceError(fallbackKey);
  const { code, params, messageCode, messageParams } = event;
  return Object.assign(new Error(String(event.message)),
    Object.fromEntries(Object.entries({ code, params, messageCode, messageParams }).filter(([, value]) => value !== undefined)));
}

// What a screen shows for a caught failure; a thrown string is shown as written.
function voiceErrorText(cause) {
  return errorMessage(cause, typeof cause === "string" ? cause : "");
}

// What speech says in place of content it leaves on screen, in the active language.
function voiceSpeechWording() {
  return {
    code: t("jskit.assistant.voice.speech.codeOnScreen"),
    sql: t("jskit.assistant.voice.speech.sqlOnScreen"),
    details: t("jskit.assistant.voice.speech.detailsInChat"),
    image: t("jskit.assistant.voice.speech.image"),
    link: t("jskit.assistant.voice.speech.link")
  };
}

export { useJskitText, voiceError, voiceErrorText, voiceEventError, voiceSpeechWording };
