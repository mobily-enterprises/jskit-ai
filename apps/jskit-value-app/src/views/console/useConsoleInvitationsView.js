import { computed, onMounted, reactive, ref } from "vue";
import { useNavigate, useRouterState } from "@tanstack/vue-router";
import { createSurfacePaths, resolveSurfacePaths } from "../../../shared/routing/surfacePaths.js";
import { useConsoleStore } from "../../stores/consoleStore.js";

export function useConsoleInvitationsView() {
  const navigate = useNavigate();
  const consoleStore = useConsoleStore();
  const routerPath = useRouterState({
    select: (state) => state.location.pathname
  });
  const surfacePaths = computed(() => resolveSurfacePaths(routerPath.value));
  const appSurfacePaths = createSurfacePaths("app");

  const message = ref("");
  const messageType = ref("error");
  const inviteAction = ref({
    token: "",
    decision: ""
  });

  const pendingInvites = computed(() => consoleStore.pendingInvites || []);

  async function acceptInvite(invite) {
    inviteAction.value = {
      token: String(invite?.token || ""),
      decision: "accept"
    };
    message.value = "";

    try {
      await consoleStore.respondToPendingInvite(invite.token, "accept");
      await navigate({
        to: surfacePaths.value.rootPath,
        replace: true
      });
    } catch (error) {
      messageType.value = "error";
      message.value = String(error?.message || "Unable to accept invite.");
    } finally {
      inviteAction.value = {
        token: "",
        decision: ""
      };
    }
  }

  async function refuseInvite(invite) {
    inviteAction.value = {
      token: String(invite?.token || ""),
      decision: "refuse"
    };
    message.value = "";

    try {
      await consoleStore.respondToPendingInvite(invite.token, "refuse");
      messageType.value = "success";
      message.value = "Invitation refused.";
    } catch (error) {
      messageType.value = "error";
      message.value = String(error?.message || "Unable to refuse invite.");
    } finally {
      inviteAction.value = {
        token: "",
        decision: ""
      };
    }
  }

  onMounted(async () => {
    try {
      await consoleStore.refreshBootstrap();
    } catch (error) {
      messageType.value = "error";
      message.value = String(error?.message || "Unable to load console invitations.");
      return;
    }

    if (consoleStore.hasAccess) {
      await navigate({
        to: surfacePaths.value.rootPath,
        replace: true
      });
      return;
    }

    if (!pendingInvites.value.length) {
      await navigate({
        to: appSurfacePaths.rootPath,
        replace: true
      });
    }
  });

  return {
    feedback: reactive({
      message,
      messageType
    }),
    selection: reactive({
      inviteAction
    }),
    collections: reactive({
      pendingInvites
    }),
    actions: {
      acceptInvite,
      refuseInvite
    }
  };
}
