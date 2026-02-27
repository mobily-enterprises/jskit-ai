import { createController as createSettingsAdapterController } from "@jskit-ai/settings-fastify-adapter";
import { resolveSurfaceFromPathname } from "../../../shared/surfacePaths.js";

const SETTINGS_ACTION_IDS = Object.freeze({
  EXTENSIONS_READ: "settings.extensions.read",
  EXTENSIONS_UPDATE: "settings.extensions.update"
});

async function executeAction(actionExecutor, { actionId, request, input = {} }) {
  return actionExecutor.execute({
    actionId,
    input,
    context: {
      request,
      channel: "api"
    }
  });
}

function createController(options = {}) {
  const resolvedOptions = options && typeof options === "object" ? options : {};
  const actionExecutor = resolvedOptions.actionExecutor;
  if (!actionExecutor || typeof actionExecutor.execute !== "function") {
    throw new Error("actionExecutor.execute is required.");
  }

  const adapterController = createSettingsAdapterController({
    ...resolvedOptions,
    resolveSurfaceFromPathname
  });

  async function getExtension(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: SETTINGS_ACTION_IDS.EXTENSIONS_READ,
      request,
      input: {
        extensionId: request.params?.extensionId
      }
    });

    reply.code(200).send(response);
  }

  async function updateExtension(request, reply) {
    const payload = request.body || {};
    const response = await executeAction(actionExecutor, {
      actionId: SETTINGS_ACTION_IDS.EXTENSIONS_UPDATE,
      request,
      input: {
        ...payload,
        extensionId: request.params?.extensionId
      }
    });

    reply.code(200).send(response);
  }

  return {
    ...adapterController,
    getExtension,
    updateExtension
  };
}

export { createController };
