import { TOKENS } from "@jskit-ai/support-core/tokens";
import { createServerContributions } from "../../shared/server.js";

function createServiceDefinitionMap() {
  const contributions = createServerContributions();
  const map = new Map();

  for (const definition of Array.isArray(contributions?.services) ? contributions.services : []) {
    if (!definition?.id || typeof definition.create !== "function") {
      continue;
    }
    map.set(definition.id, definition);
  }

  return map;
}

function resolveCommonDependencies(scope) {
  const dependencies = {};
  if (scope.has(TOKENS.Env)) {
    dependencies.env = scope.make(TOKENS.Env);
  }
  if (scope.has(TOKENS.Logger)) {
    dependencies.logger = scope.make(TOKENS.Logger);
  }
  return dependencies;
}

function resolveOptionalRepositories(scope) {
  const repositories = {};
  if (scope.has("userProfilesRepository")) {
    repositories.userProfilesRepository = scope.make("userProfilesRepository");
  }
  if (scope.has("userSettingsRepository")) {
    repositories.userSettingsRepository = scope.make("userSettingsRepository");
  }
  return repositories;
}

class AuthSupabaseServiceProvider {
  static id = "auth.provider.supabase";

  static dependsOn = [];

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("AuthSupabaseServiceProvider requires application singleton().");
    }

    const definitions = createServiceDefinitionMap();
    const authServiceDefinition = definitions.get("authService");
    const actionRegistryDefinition = definitions.get("actionRegistry");
    const actionExecutorDefinition = definitions.get("actionExecutor");

    if (!authServiceDefinition || !actionRegistryDefinition || !actionExecutorDefinition) {
      throw new Error("AuthSupabaseServiceProvider could not resolve expected service definitions.");
    }

    if (!app.has("authService")) {
      app.singleton("authService", (scope) => {
        return authServiceDefinition.create({
          repositories: resolveOptionalRepositories(scope),
          dependencies: resolveCommonDependencies(scope)
        });
      });
    }

    if (!app.has("actionRegistry")) {
      app.singleton("actionRegistry", (scope) => {
        return actionRegistryDefinition.create({
          services: {
            authService: scope.make("authService")
          },
          dependencies: resolveCommonDependencies(scope)
        });
      });
    }

    if (!app.has("actionExecutor")) {
      app.singleton("actionExecutor", (scope) => {
        return actionExecutorDefinition.create({
          services: {
            actionRegistry: scope.make("actionRegistry")
          }
        });
      });
    }
  }
}

export { AuthSupabaseServiceProvider };
