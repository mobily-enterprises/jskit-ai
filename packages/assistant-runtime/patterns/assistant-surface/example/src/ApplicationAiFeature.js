import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createAiConnectionResolver } from "@jskit-ai/connectors-catalog/server/ai";
import { createEnvironmentReferenceResolver } from "@jskit-ai/connectors-core/server";
import configuration from "../integrations.json" with { type: "json" };

// Register this in the application's ordinary server feature list.
export const ApplicationAiFeature = defineFeature({
  id: "app.ai", requires: { env: "runtime.env" }, provides: { ai: "integrations.ai" },
  setup({ env }) {
    return { ai: createAiConnectionResolver({
      configuration,
      authorize(context) {
        if (!context.actor?.id) return null;
        // Apply the app's AI-use policy here; the actor comes from authentication.
        return { applicationId: "my-app", subjectId: String(context.actor.id) };
      },
      resolveReference: createEnvironmentReferenceResolver(env)
    }) };
  }
});
