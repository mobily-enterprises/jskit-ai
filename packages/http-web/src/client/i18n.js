import { createTextError, registerJskitMessages, useJskitText } from "@jskit-ai/kernel/client/i18n";
import crudEnglish from "@jskit-ai/resource-crud-core/locales/en.json" with { type: "json" };
import en from "../../locales/en.json" with { type: "json" };

// http-web's English and the CRUD filter words it renders, registered on import
// so its screens and composables translate in fixtures and tests as well as in a
// bootstrapped app.
registerJskitMessages(crudEnglish);
registerJskitMessages(en);

export { createTextError, useJskitText };
