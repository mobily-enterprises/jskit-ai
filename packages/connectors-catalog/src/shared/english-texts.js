import { createEnglishProviderTexts } from "@jskit-ai/connectors-core/shared/configuration";
import en from "../../locales/en.json" with { type: "json" };

// One renderer for both English entries, so an English definition is the same object in each.
const englishTexts = createEnglishProviderTexts(en);

export { englishTexts };
