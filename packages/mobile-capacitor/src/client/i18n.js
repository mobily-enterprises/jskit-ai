import { registerJskitMessages, useJskitText } from "@jskit-ai/kernel/client/i18n";
import { catalogMessage, formatMessage } from "@jskit-ai/kernel/shared/i18n";
import en from "../../locales/en.json" with { type: "json" };

// mobile-capacitor's English, registered on import so its errors render in the
// user's language wherever the app shows them.
registerJskitMessages(en);

// A client-made error: its message stays the English text, and its messageCode
// lets useJskitText().errorMessage show it in the user's language. A message
// that is not one of this package's keys (a caller's own text) is used as given.
function createTextError(keyOrMessage = "", params = {}) {
  const english = catalogMessage(en, keyOrMessage);
  if (english === undefined) {
    return new Error(keyOrMessage);
  }
  const error = new Error(formatMessage(english, params));
  error.messageCode = keyOrMessage.slice("jskit.".length);
  error.messageParams = params;
  return error;
}

export { createTextError, useJskitText };
