import { registerJskitMessages, useJskitText } from "@jskit-ai/kernel/client";
// The runtime client also shows assistant-core's conversation errors, so it
// registers that catalog too.
import coreEnglish from "@jskit-ai/assistant-core/locales/en.json" with { type: "json" };
import en from "../../locales/en.json" with { type: "json" };

registerJskitMessages(coreEnglish);
registerJskitMessages(en);

export { useJskitText };
