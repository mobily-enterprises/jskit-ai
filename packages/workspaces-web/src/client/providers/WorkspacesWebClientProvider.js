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
        resolveBootstrapRequest(input = {}) {
          return runtime.resolveBootstrapRequest(input);
        },
        applyBootstrapPayload(input = {}) {
          return runtime.applyBootstrapPayload(input);
        },
        handleBootstrapError(input = {}) {
          return runtime.handleBootstrapError(input);
        }
      })
    );
    return {
      workspaces: Object.freeze({
        bootstrap: runtime,
        scopeSupport: createWorkspaceScopeSupport()
      })
    };
  },
  async boot({ vueApp }, { outputs }) {
    const runtime = outputs.workspaces.bootstrap;
    if (runtime && typeof runtime.initialize === "function") {
      await runtime.initialize();
    }

    if (!vueApp || typeof vueApp.provide !== "function") {
      return;
    }

    vueApp.provide(
      WORKSPACES_WEB_SCOPE_SUPPORT_INJECTION_KEY,
      outputs.workspaces.scopeSupport
    );
  },
  shutdown(_dependencies, { outputs }) {
    const runtime = outputs.workspaces.bootstrap;
    if (runtime && typeof runtime.shutdown === "function") {
      runtime.shutdown();
    }
  }
});

export { WorkspacesWebClientProvider };
import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
