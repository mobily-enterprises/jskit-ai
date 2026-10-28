import { createSchema } from "json-rest-schema";

const posthogDefinition = Object.freeze({
  id: "posthog", name: "PostHog", description: "jskit.connectors.posthog.description",
  accountModes: ["shared", "assistant"], authenticationMethods: ["api-key"], scopes: [],
  apiKeyReferenceLabel: "jskit.connectors.posthog.apiKeyReferenceLabel",
  verificationFields: [{ name: "distinct_id", required: true, label: "jskit.connectors.posthog.verificationFields.distinctId.label",
    hint: "jskit.connectors.posthog.verificationFields.distinctId.hint" }],
  apiKeyReferenceHint: "jskit.connectors.posthog.apiKeyReferenceHint",
  settingsSchema: createSchema({
    region: { type: "string", enum: ["eu", "us"], defaultTo: "eu" },
    projectId: { type: "string", required: true, minLength: 1, maxLength: 20,
      validator: (value) => /^[1-9][0-9]*$/u.test(value) || "Enter the numeric project ID from PostHog project settings." }
  }),
  settingsFields: [
    { name: "region", label: "jskit.connectors.posthog.fields.region.label", hint: "jskit.connectors.posthog.fields.region.hint", items: [
      { value: "eu", title: "jskit.connectors.posthog.fields.region.items.eu.title" }, { value: "us", title: "jskit.connectors.posthog.fields.region.items.us.title" }
    ] },
    { name: "projectId", label: "jskit.connectors.posthog.fields.projectId.label", placeholder: "12345",
      hint: "jskit.connectors.posthog.fields.projectId.hint" }
  ],
  setup: {
    url: "https://posthog.com/docs/settings/projects",
    steps: [
      "Sign into the intended PostHog Cloud region. Use the project switcher to create or select the project's analytics destination.",
      "Open Project settings and copy its numeric project ID and public project token (phc_). Keep that project's region selected here.",
      "Store the project token in Env and enter its reference. This is a publishable token, not a personal, project-secret or OAuth API key.",
      "Save the configuration. The application runtime verifies token acceptance by evaluating flags for an explicitly supplied user identifier.",
      "Event capture is a separate operation. Verification does not submit an analytics event or prove final event ingestion."
    ]
  }
});
export { posthogDefinition };
