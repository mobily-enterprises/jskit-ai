import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/contracts/errorResponses";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { workspaceRoutesContract as workspaceSchema } from "../../shared/contracts/workspaceRoutesContract.js";

const WORKSPACE_SETTINGS_ACTION_IDS = Object.freeze({
  SETTINGS_READ: "workspace.settings.read",
  SETTINGS_UPDATE: "workspace.settings.update"
});

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeWorkspaceParams(params) {
  const source = normalizeObjectInput(params);
  return {
    workspaceSlug: source.workspaceSlug
  };
}

class WorkspaceSettingsController {
  constructor({ workspaceService } = {}) {
    if (!workspaceService || typeof workspaceService.resolveWorkspaceContextForUserBySlug !== "function") {
      throw new Error("WorkspaceSettingsController requires workspaceService.resolveWorkspaceContextForUserBySlug().");
    }
    this.workspaceService = workspaceService;
  }

  async resolveWorkspaceRequestContext(request) {
    const params = normalizeObjectInput(request?.input?.params);
    const workspaceSlug = normalizeText(params.workspaceSlug).toLowerCase();

    const resolvedWorkspaceContext = await this.workspaceService.resolveWorkspaceContextForUserBySlug(
      request?.user,
      workspaceSlug,
      {
        request
      }
    );

    return {
      workspaceSlug,
      context: {
        workspace: resolvedWorkspaceContext.workspace,
        membership: resolvedWorkspaceContext.membership,
        permissions: resolvedWorkspaceContext.permissions
      }
    };
  }

  async getWorkspaceSettings(request, reply) {
    const workspaceRequestContext = await this.resolveWorkspaceRequestContext(request);
    const response = await request.executeAction({
      actionId: WORKSPACE_SETTINGS_ACTION_IDS.SETTINGS_READ,
      input: {
        workspaceSlug: workspaceRequestContext.workspaceSlug
      },
      context: workspaceRequestContext.context
    });
    reply.code(200).send(response);
  }

  async updateWorkspaceSettings(request, reply) {
    const workspaceRequestContext = await this.resolveWorkspaceRequestContext(request);
    const response = await request.executeAction({
      actionId: WORKSPACE_SETTINGS_ACTION_IDS.SETTINGS_UPDATE,
      input: {
        workspaceSlug: workspaceRequestContext.workspaceSlug,
        ...normalizeObjectInput(request.input.body)
      },
      context: workspaceRequestContext.context
    });
    reply.code(200).send(response);
  }
}

function registerWorkspaceSettingsRoutes(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("registerWorkspaceSettingsRoutes requires application make().");
  }

  const router = app.make(KERNEL_TOKENS.HttpRouter);
  const workspaceService = app.make("users.workspace.service");
  const workspaceSettingsController = new WorkspaceSettingsController({
    workspaceService: workspaceService
  });
  const workspaceRouteTags = ["workspace"];
  const getWorkspaceSettingsHandler = workspaceSettingsController.getWorkspaceSettings.bind(workspaceSettingsController);
  const updateWorkspaceSettingsHandler = workspaceSettingsController.updateWorkspaceSettings.bind(workspaceSettingsController);

  router.register(
    "GET",
    "/api/app/w/:workspaceSlug/workspace/settings",
    {
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      meta: {
        tags: workspaceRouteTags,
        summary: "Get workspace settings and role catalog by workspace slug"
      },
      params: {
        schema: workspaceSchema.params.workspace,
        normalize: normalizeWorkspaceParams
      },
      response: withStandardErrorResponses({
        200: workspaceSchema.response.settings
      }),
      handler: getWorkspaceSettingsHandler
    },
    getWorkspaceSettingsHandler
  );

  router.register(
    "PATCH",
    "/api/app/w/:workspaceSlug/workspace/settings",
    {
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      meta: {
        tags: workspaceRouteTags,
        summary: "Update workspace settings by workspace slug"
      },
      params: {
        schema: workspaceSchema.params.workspace,
        normalize: normalizeWorkspaceParams
      },
      body: {
        schema: workspaceSchema.body.settingsUpdate,
        normalize: normalizeObjectInput
      },
      response: withStandardErrorResponses(
        {
          200: workspaceSchema.response.settings
        },
        { includeValidation400: true }
      ),
      handler: updateWorkspaceSettingsHandler
    },
    updateWorkspaceSettingsHandler
  );

  router.register(
    "GET",
    "/api/admin/w/:workspaceSlug/workspace/settings",
    {
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      meta: {
        tags: workspaceRouteTags,
        summary: "Get workspace settings and role catalog by workspace slug"
      },
      params: {
        schema: workspaceSchema.params.workspace,
        normalize: normalizeWorkspaceParams
      },
      response: withStandardErrorResponses({
        200: workspaceSchema.response.settings
      }),
      handler: getWorkspaceSettingsHandler
    },
    getWorkspaceSettingsHandler
  );

  router.register(
    "PATCH",
    "/api/admin/w/:workspaceSlug/workspace/settings",
    {
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      meta: {
        tags: workspaceRouteTags,
        summary: "Update workspace settings by workspace slug"
      },
      params: {
        schema: workspaceSchema.params.workspace,
        normalize: normalizeWorkspaceParams
      },
      body: {
        schema: workspaceSchema.body.settingsUpdate,
        normalize: normalizeObjectInput
      },
      response: withStandardErrorResponses(
        {
          200: workspaceSchema.response.settings
        },
        { includeValidation400: true }
      ),
      handler: updateWorkspaceSettingsHandler
    },
    updateWorkspaceSettingsHandler
  );
}

export {
  WorkspaceSettingsController,
  WORKSPACE_SETTINGS_ACTION_IDS,
  registerWorkspaceSettingsRoutes
};
