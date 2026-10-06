import { createActionProvider } from "@jskit-ai/kernel/server/actions";
import { HttpProvider } from "@jskit-ai/kernel/server/http";
import { AppError, BootstrapProvider, EventProvider } from "@jskit-ai/kernel/server/runtime";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { AssistantFeature } from "./AssistantProvider.js";

/**
 * Configure the existing conversation feature in a plain Fastify application.
 * The caller owns runtime creation/storage and authentication. This registration
 * owns its HTTP/realtime hosting and shuts it down before Fastify closes.
 * JSKIT applications register AssistantFeature on their existing host instead.
 */
async function registerFastifyConversations(app, {
  runtime,
  config,
  authenticate,
  bootstrap,
  env = process.env
} = {}) {
  if (typeof runtime?.open !== "function" || typeof authenticate !== "function" ||
      !config || typeof config !== "object" || Array.isArray(config)) {
    throw new TypeError("Fastify conversations require runtime, config and authenticate(request).");
  }
  async function requestContext(request) {
    const context = await authenticate(request);
    if (!context || typeof context !== "object" || Array.isArray(context)) {
      throw new AppError(401, "Authentication required.");
    }
    return context;
  }
  const AccessProvider = defineProvider({
    id: "assistant.fastify.access",
    requires: { http: "runtime.http", bootstrap: "runtime.bootstrap", actions: "runtime.actions" },
    provides: { access: "assistant.conversation.access" },
    setup({ http, bootstrap: bootstrapRuntime, actions }) {
      actions.registerContextContributor({
        id: "assistant.fastify.authentication",
        contribute: ({ context }) => requestContext(context.requestMeta?.request)
      });
      bootstrapRuntime.register({
        id: "assistant.fastify.application",
        async contribute({ request }) {
          const context = await requestContext(request);
          return bootstrap ? bootstrap({ request, context }) : {};
        }
      });
      return { access: {
        router: { register(method, path, contract, handler) {
          http.router.register(method, path, { ...contract, auth: "public" }, async (request, reply) => {
            await requestContext(request);
            return handler(request, reply);
          });
        } },
        wrapAction(definition) {
          return { ...definition, permission: { require: "none" } };
        },
        subscribeActionId: "assistant.fastify.conversation.subscribe",
        requestPolicy: "host"
      } };
    }
  });
  // Realtime remains optional for consumers using the feature on their own host.
  const { RealtimeProvider } = await import("@jskit-ai/realtime/server/RealtimeProvider");
  const host = createCapabilityRuntime({
    providers: [EventProvider, createActionProvider(), HttpProvider, BootstrapProvider,
      RealtimeProvider, AccessProvider, AssistantFeature],
    inputs: { "runtime.config": config, "runtime.env": env, "runtime.fastify": app,
      "runtime.logger": app.log, "assistant.conversations": runtime }
  });
  app.addHook("preClose", async () => {
    if (host.diagnostics().lifecycleState === "started") await host.shutdown();
  });
  await host.start();
}

export { registerFastifyConversations };
