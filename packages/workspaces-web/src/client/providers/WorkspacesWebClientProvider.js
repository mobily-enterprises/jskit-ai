import WorkspaceProfileSurfaceSwitchMenuItem from "../components/WorkspaceProfileSurfaceSwitchMenuItem.vue";
import WorkspaceSelector from "../components/WorkspaceSelector.vue";
import WorkspaceToolsWidget from "../components/WorkspaceToolsWidget.vue";
import WorkspaceSettingsMenuItem from "../components/WorkspaceSettingsMenuItem.vue";
import WorkspaceMembersMenuItem from "../components/WorkspaceMembersMenuItem.vue";
import MembersAdminClientElement from "../components/MembersAdminClientElement.vue";
import { createBootstrapPlacementRuntime } from "../runtime/bootstrapPlacementRuntime.js";
import {
  WORKSPACES_WEB_SCOPE_SUPPORT_INJECTION_KEY,
  createWorkspaceScopeSupport
} from "../support/workspaceScopeSupport.js";

const WorkspacesWebClientProvider = defineProvider({
  id: "workspaces.web.client",
  requires: {
    components: "client.components",
    logger: "client.logger",
    router: "client.router",
    shell: "client.shell",
    vueApp: "client.vue"
  },
  optional: {
    realtime: "client.realtime"
  },
  provides: {
    workspaces: "client.workspaces"
  },
  /**
   * @param {object} capabilities
   * @param {import("@jskit-ai/kernel/client/types").ClientComponents} capabilities.components
   * @param {import("@jskit-ai/kernel/client/types").ClientLogger} capabilities.logger
   * @param {import("../types.js").WorkspaceRealtime | null} capabilities.realtime
   * @param {import("@jskit-ai/kernel/client/types").ClientRouter} capabilities.router
   * @param {import("../types.js").WorkspaceShell} capabilities.shell
   * @param {import("@jskit-ai/kernel/client/types").ClientVueApp} capabilities.vueApp
   */
  setup({ components, logger, realtime, router, shell, vueApp }) {
    components.register("workspaces.web.profile.menu.surface-switch-item", WorkspaceProfileSurfaceSwitchMenuItem);
    components.register("workspaces.web.workspace.selector", WorkspaceSelector);
    components.register("workspaces.web.workspace.tools.widget", WorkspaceToolsWidget);
    components.register("workspaces.web.workspace-settings.menu-item", WorkspaceSettingsMenuItem);
    components.register("workspaces.web.workspace-members.menu-item", WorkspaceMembersMenuItem);
    components.register("workspaces.web.members-admin.element", MembersAdminClientElement);

    const runtime = createBootstrapPlacementRuntime({
      bootstrapRuntime: shell.bootstrap,
      placementRuntime: shell.placement,
      realtime,
      router,
      vueApp,
      logger
    });
    shell.bootstrapHandlers.register(
      Object.freeze({
        handlerId: "workspaces.web.bootstrap",
        order: 100,
        resolveBootstrapRequest: runtime.resolveBootstrapRequest,
        applyBootstrapPayload: runtime.applyBootstrapPayload,
        handleBootstrapError: runtime.handleBootstrapError
      })
    );
    return {
      workspaces: Object.freeze({
        bootstrap: runtime,
        scopeSupport: createWorkspaceScopeSupport()
      })
    };
  },
  /**
   * @param {{ vueApp: import("@jskit-ai/kernel/client/types").ClientVueApp }} capabilities
   * @param {{ outputs: { workspaces: import("../types.js").WorkspacesClient } }} lifecycle
   */
  async boot({ vueApp }, { outputs }) {
    await outputs.workspaces.bootstrap.initialize();

    vueApp.provide(
      WORKSPACES_WEB_SCOPE_SUPPORT_INJECTION_KEY,
      outputs.workspaces.scopeSupport
    );
  },
  /**
   * @param {object} _capabilities
   * @param {{ outputs: { workspaces: import("../types.js").WorkspacesClient } }} lifecycle
   */
  shutdown(_capabilities, { outputs }) {
    outputs.workspaces.bootstrap.shutdown();
  }
});

export { WorkspacesWebClientProvider };
import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
