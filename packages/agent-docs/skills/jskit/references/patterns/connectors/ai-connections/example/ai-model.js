import { createAiConnectionResolver } from "@jskit-ai/connectors-catalog/server/ai";

// App-owned composition. Supply the authenticated authorization policy and the
// SDK model factory used by this application. Omit resolveReference for Env.
/**
 * @param {object} dependencies
 * @param {object} dependencies.configuration The integration configuration.
 * @param {(context: object, request: object) => Promise<object | null>} dependencies.authorize The application's access policy: the owner, or null.
 * @param {(reference: string, owner: object, slot: object) => Promise<string>} [dependencies.resolveReference]
 * @param {(parameters: object) => unknown} dependencies.createModel The application's SDK model factory.
 */
export function createConfiguredAiModel({ configuration, authorize, resolveReference, createModel }) {
  const connections = createAiConnectionResolver({ configuration, authorize, resolveReference });
  return async ({ context, integrationId }) => {
    const parameters = await connections.resolve({ context, integrationId });
    return createModel(parameters); // Backend only; the app owns subsequent inference.
  };
}
