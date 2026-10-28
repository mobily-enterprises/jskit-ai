import { registerJskitMessages, useJskitText } from "@jskit-ai/kernel/client";
import en from "../../locales/en.json" with { type: "json" };

registerJskitMessages(en);

export { useJskitText };
