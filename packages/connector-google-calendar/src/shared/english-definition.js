// "@jskit-ai/connector-google-calendar/shared" in English; the keyed definition is in
// definition.js (see connectors-core createEnglishProviderTexts).
import { createEnglishProviderTexts } from "@jskit-ai/connectors-core/shared/configuration";
import en from "../../locales/en.json" with { type: "json" };
import { googleCalendarDefinition as keyedDefinition } from "./definition.js";

export { googleScope } from "./definition.js";
export const googleCalendarDefinition = createEnglishProviderTexts(en)(keyedDefinition);
