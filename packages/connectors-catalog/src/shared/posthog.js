import { createSchema } from "json-rest-schema";

const posthogDefinition = Object.freeze({
  id: "posthog", name: "PostHog", description: "Capture events and evaluate flags with a public project token.",
  accountModes: ["shared", "assistant"], authenticationMethods: ["api-key"], scopes: [],
  apiKeyReferenceLabel: "Project token reference",
  verificationFields: [{ name: "distinct_id", required: true, label: "Verification user ID",
    hint: "Enter the identity whose feature flags should be evaluated. This check does not submit an analytics event." }],
  apiKeyReferenceHint: "Use an environment reference for the project's public token (phc_). Your app may expose that token in its frontend. It cannot read private analytics.",
  settingsSchema: createSchema({
    region: { type: "string", enum: ["eu", "us"], defaultTo: "eu" },
    projectId: { type: "string", required: true, minLength: 1, maxLength: 20,
      validator: (value) => /^[1-9][0-9]*$/u.test(value) || "Enter the numeric project ID from PostHog project settings." }
  }),
  settingsFields: [
    { name: "region", label: "Region", hint: "Choose the PostHog Cloud region containing this project.", items: [
      { value: "eu", title: "Europe (eu.i.posthog.com)" }, { value: "us", title: "United States (us.i.posthog.com)" }
    ] },
    { name: "projectId", label: "Project ID", placeholder: "12345",
      hint: "Public numeric ID from project settings. Public API requests use the token to select the project; verification does not match this ID to the token." }
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
