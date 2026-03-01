import { TOKENS } from "@jskit-ai/support-core/tokens";
import { createServerContributions } from "../../shared/server.js";

function resolvePolicyPluginDefinition() {
  const contributions = createServerContributions();
  const plugins = Array.isArray(contributions?.plugins) ? contributions.plugins : [];
  const definition = plugins.find((entry) => entry?.id === "auth-policy");
  if (!definition || typeof definition.create !== "function") {
    throw new Error("FastifyAuthPolicyServiceProvider could not resolve auth-policy plugin definition.");
  }
  return definition;
}

class FastifyAuthPolicyServiceProvider {
  static id = "auth.policy.fastify";

  static dependsOn = ["auth.provider.supabase"];

  register(app) {
    if (!app || typeof app.has !== "function") {
      throw new Error("FastifyAuthPolicyServiceProvider requires application has().");
    }
  }

  async boot(app) {
    if (!app || typeof app.make !== "function" || typeof app.has !== "function") {
      throw new Error("FastifyAuthPolicyServiceProvider requires application make()/has().");
    }
    if (!app.has("authService")) {
      throw new Error("FastifyAuthPolicyServiceProvider requires authService binding.");
    }

    const policyPluginDefinition = resolvePolicyPluginDefinition();
    const env = app.has(TOKENS.Env) ? app.make(TOKENS.Env) : {};
    const logger = app.has(TOKENS.Logger) ? app.make(TOKENS.Logger) : console;
    const fastify = app.make(TOKENS.Fastify);

    const plugin = await policyPluginDefinition.create({
      services: {
        authService: app.make("authService")
      },
      dependencies: {
        env,
        logger
      }
    });

    if (typeof plugin === "function") {
      await fastify.register(plugin);
      return;
    }
    if (plugin && typeof plugin.register === "function") {
      await plugin.register(fastify, {
        app
      });
      return;
    }

    throw new Error("FastifyAuthPolicyServiceProvider plugin definition returned an unsupported registration shape.");
  }
}

export { FastifyAuthPolicyServiceProvider };
