import { registerJskitMessages, useJskitText } from "@jskit-ai/kernel/client/i18n";
import { catalogMessage, formatMessage } from "@jskit-ai/kernel/shared/i18n";
import en from "../../locales/en.json" with { type: "json" };

// http-web's English, registered on import so its screens and composables
// translate in fixtures and tests as well as in a bootstrapped app.
registerJskitMessages(en);

// A client-made error: its message stays the English text, and its messageCode
// lets useJskitText().errorMessage show it in the user's language.
function createTextError(key, params = {}) {
  const error = new Error(formatMessage(catalogMessage(en, key), params));
  error.messageCode = key.slice("jskit.".length);
  error.messageParams = params;
  return error;
}

export { createTextError, useJskitText };
