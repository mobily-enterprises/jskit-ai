import { createRuntimeActionRegistry } from "./createActionRegistry.js";
import { createActionContributors } from "./contributorManifest.js";
import { buildExecutionContext } from "./buildExecutionContext.js";

function createActionExecutor({ actionRegistry, defaultDeps = {} } = {}) {
  if (!actionRegistry || typeof actionRegistry.execute !== "function") {
    throw new Error("actionRegistry.execute is required.");
  }

  return Object.freeze({
    async execute({ actionId, version = null, input = {}, context = {}, deps = {} } = {}) {
      const executionContext = buildExecutionContext(context);

      return actionRegistry.execute({
        actionId,
        version,
        input,
        context: executionContext,
        deps: {
          ...(defaultDeps || {}),
          ...(deps || {})
        }
      });
    },
    async executeStream({ actionId, version = null, input = {}, context = {}, deps = {} } = {}) {
      const executionContext = buildExecutionContext(context);

      return actionRegistry.executeStream({
        actionId,
        version,
        input,
        context: executionContext,
        deps: {
          ...(defaultDeps || {}),
          ...(deps || {})
        }
      });
    },
    listDefinitions() {
      return actionRegistry.listDefinitions();
    },
    getDefinition(actionId, version = null) {
      return actionRegistry.getDefinition(actionId, version);
    }
  });
}

function createActionRuntimeServices({ services, repositories, repositoryConfig, appConfig, rbacManifest } = {}) {
  const logger =
    services?.observabilityService && typeof services.observabilityService.createScopedLogger === "function"
      ? services.observabilityService.createScopedLogger("actions.runtime")
      : console;

  const contributors = createActionContributors({
    services,
    repositories,
    repositoryConfig,
    appConfig,
    rbacManifest
  });

  const actionRegistry = createRuntimeActionRegistry({
    contributors,
    services,
    logger
  });

  const actionExecutor = createActionExecutor({
    actionRegistry,
    defaultDeps: {
      services,
      repositories,
      repositoryConfig,
      appConfig,
      rbacManifest
    }
  });

  return Object.freeze({
    actionRegistry,
    actionExecutor
  });
}

export { createActionRuntimeServices, createActionExecutor };
