import { registerJskitMessages, useJskitText } from "@jskit-ai/kernel/client/i18n";
import en from "../../locales/en.json" with { type: "json" };

registerJskitMessages(en);

export { useJskitText };
