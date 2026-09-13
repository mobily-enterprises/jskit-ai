import { createSchema } from "json-rest-schema";
import { secretReference } from "@jskit-ai/connectors-core/shared/configuration";

const algoliaDefinition = Object.freeze({
  id: "algolia", name: "Algolia", description: "Search and maintain index records, and check indexing completion.",
  accountModes: ["shared", "assistant"], authenticationMethods: ["api-key"], scopes: [],
  settingsSchema: createSchema({
    applicationId: { type: "string", required: true, minLength: 1, maxLength: 63,
      validator: (value) => /^[a-z0-9]+$/iu.test(value) || "Enter the application ID using letters and digits." },
    publicApiKeyRef: { ...secretReference, required: false }
  }),
  settingsFields: [
    { name: "applicationId", label: "Application ID", hint: "Copy the ID from your Algolia application's API Keys page. This ID can be public." },
    { name: "publicApiKeyRef", environmentCredential: { label: "Public frontend API key", public: true }, label: "Public API key reference (optional)", placeholder: "env:ALGOLIA_SEARCH_KEY",
      hint: "Optional search-only key for your frontend. Enter its reference; your app decides whether to publish its value." }
  ],
  setup: {
    url: "https://www.algolia.com/doc/guides/security/api-keys",
    steps: [
      "Select the intended Algolia application, open API Keys and copy its Application ID into Application ID here.",
      "Open All API Keys, then New API Key. Give the key a description, select List indices (listIndexes) and Search (search), add Add records (addObject) for indexing/task status and Delete records (deleteObject) for deletion only when needed. Restrict Indices to those this application needs, and choose Create. These operations do not require the Admin API key.",
      "Copy the new backend key. Enter env:ALGOLIA_API_KEY in API key reference here and save. Choose Set credential in Env for ALGOLIA_API_KEY, paste its value and save it there.",
      "If the frontend will search Algolia directly, create a separate key with Search (search) access restricted to indices safe for those users to read. Enter env:ALGOLIA_SEARCH_KEY in Public API key reference (optional), save, then use its Set credential in Env link to store that key value.",
      "Return here and choose Connect account (or Verify again for an existing connection). Check connection only reads the application’s saved status. No OAuth registration or callback URL is needed. Verification lists indices with the backend key; it does not validate the optional frontend key.",
      "If access fails, check the Application ID, selected indices, permissions and key expiry. Your framework owns publishing the optional frontend key; keep the backend key server-side."
    ]
  }
});
export { algoliaDefinition };
