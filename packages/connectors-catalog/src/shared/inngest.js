import { createSchema } from "json-rest-schema";
import { secretReference } from "@jskit-ai/connectors-core/shared/configuration";

const inngestDefinition = Object.freeze({
  id: "inngest", name: "Inngest", description: "Send events to background workflows and inspect registered apps.",
  accountModes: ["shared", "assistant"], authenticationMethods: ["api-key"], scopes: [],
  apiKeyReferenceLabel: "Signing Key reference",
  apiKeyReferenceHint: "Reference the Signing Key for the intended Inngest environment. Verification reads app metadata; it does not verify the Event Key or run a workflow.",
  settingsSchema: createSchema({
    eventKeyRef: { ...secretReference, required: true },
    branchEnvironment: { type: "string", minLength: 1, maxLength: 255,
      validator: (value) => /^[\x21-\x7e]+$/u.test(value) || "Use an ASCII branch environment without spaces or control characters." }
  }),
  settingsFields: [
    { name: "eventKeyRef", label: "Event Key reference", placeholder: "env:INNGEST_EVENT_KEY",
      environmentCredential: { label: "Inngest Event Key", public: false },
      hint: "The Event Key sends events. Keep it separate from the Signing Key, and use keys from the same intended environment." },
    { name: "branchEnvironment", label: "Branch environment (optional)", placeholder: "feature/my-branch",
      hint: "Routes event delivery to this branch. App metadata reads follow the Signing Key's environment." }
  ],
  setup: {
    url: "https://www.inngest.com/docs/events/creating-an-event-key",
    steps: [
      "Open Inngest Cloud and choose the intended environment. Next to the environment selector, click the key icon > Event keys > + Create Event Key. Give it a descriptive name, choose Save changes, then Copy. Configure event-name or IP restrictions for your application if needed.",
      "Enter env:INNGEST_EVENT_KEY in Event Key reference. In the same environment's Signing Key tab, copy the Signing Key separately and enter env:INNGEST_SIGNING_KEY in Signing Key reference. The Event Key sends events; the Signing Key verifies metadata access.",
      "Save configuration. Choose Set credential in Env to save INNGEST_SIGNING_KEY. Under Inngest Event Key, choose Set credential in Env to save INNGEST_EVENT_KEY with the copied Event Key value. Save both values in backend Env and return here; the configuration file stores only references, never the keys.",
      "Leave Branch environment empty for ordinary delivery. For branch delivery, enter its exact identifier. It only changes event routing; metadata reads still use the Signing Key's environment. Save changes before connecting.",
      "Choose Connect account. Verification reads registered app metadata without sending an event. It does not check the Event Key, prove that both keys match, or prove that a workflow exists. An empty app list can still verify successfully. No OAuth app registration or callback is needed.",
      "Implement the application's functions with the native Inngest SDK: event triggers receive submitted events, cron triggers schedule work, and step.run provides durable steps. Serve them at the deployed app's /api/inngest route with the same environment Signing Key. In Inngest Cloud select the environment > Apps > Sync App or Sync New App, paste the full deployed serve URL and choose Sync App. After changing functions or domains, open that app > Resync; use Override for a changed URL and retain the same app ID. An event receipt only confirms acceptance, not workflow success. Disconnect removes the local connection; it does not revoke keys or cancel accepted runs. Coordinate signing-key rotation with the application's SDK and update Env before verifying again."

    ]
  }
});

export { inngestDefinition };
