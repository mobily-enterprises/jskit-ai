import { createTextError, registerJskitMessages, useJskitText } from "@jskit-ai/kernel/client/i18n";
import en from "../../locales/en.json" with { type: "json" };

// mobile-capacitor's English, registered on import so its errors render in the
// user's language wherever the app shows them.
registerJskitMessages(en);

export { createTextError, useJskitText };
