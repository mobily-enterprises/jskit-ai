import { createAiConnectionResolver } from "@jskit-ai/connectors-catalog/server/ai";

// App-owned composition. Supply the authenticated authorization policy and the
// SDK model factory used by this application. Omit resolveReference for Env.
export function createConfiguredAiModel({ configuration, authorize, resolveReference, createModel }) {
  const connections = createAiConnectionResolver({ configuration, authorize, resolveReference });
  return async ({ context, integrationId }) => {
    const parameters = await connections.resolve({ context, integrationId });
    return createModel(parameters); // Backend only; the app owns subsequent inference.
  };
}
