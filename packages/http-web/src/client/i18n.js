import { createTextError, registerJskitMessages, useJskitText } from "@jskit-ai/kernel/client/i18n";
import en from "../../locales/en.json" with { type: "json" };

// http-web's English, registered on import so its screens and composables
// translate in fixtures and tests as well as in a bootstrapped app.
registerJskitMessages(en);

export { createTextError, useJskitText };
