import { computed, onMounted, reactive, ref } from "vue";
import { useNavigate, useRouterState } from "@tanstack/vue-router";
import { createSurfacePaths, resolveSurfacePaths } from "../../../shared/routing/surfacePaths.js";
import { useGodStore } from "../../stores/godStore.js";

export function useGodInvitationsView() {
  const navigate = useNavigate();
  const godStore = useGodStore();
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

  const pendingInvites = computed(() => godStore.pendingInvites || []);

  async function acceptInvite(invite) {
    inviteAction.value = {
      token: String(invite?.token || ""),
      decision: "accept"
    };
    message.value = "";

    try {
      await godStore.respondToPendingInvite(invite.token, "accept");
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
      await godStore.respondToPendingInvite(invite.token, "refuse");
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
      await godStore.refreshBootstrap();
    } catch (error) {
      messageType.value = "error";
      message.value = String(error?.message || "Unable to load god invitations.");
      return;
    }

    if (godStore.hasAccess) {
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
