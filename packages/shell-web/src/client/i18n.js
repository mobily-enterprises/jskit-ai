import { registerJskitMessages, useJskitText } from "@jskit-ai/kernel/client/i18n";
import en from "../../locales/en.json" with { type: "json" };

// shell-web's English, registered on import so its components and runtimes
// translate in fixtures and tests as well as in a bootstrapped app.
registerJskitMessages(en);

export { useJskitText };
