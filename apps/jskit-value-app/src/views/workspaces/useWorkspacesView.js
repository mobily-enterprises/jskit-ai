import { computed, onMounted, reactive, ref } from "vue";
import { useNavigate, useRouterState } from "@tanstack/vue-router";
import { resolveSurfacePaths } from "../../../shared/routing/surfacePaths.js";
import { coerceWorkspaceColor } from "../../../shared/workspace/colors.js";
import { useWorkspaceStore } from "../../stores/workspaceStore.js";

function workspaceInitials(workspace) {
  const source = String(workspace?.name || workspace?.slug || "W").trim();
  return source.slice(0, 2).toUpperCase();
}

export function useWorkspacesView() {
  const navigate = useNavigate();
  const routerPath = useRouterState({
    select: (state) => state.location.pathname
  });
  const surfacePaths = computed(() => resolveSurfacePaths(routerPath.value));
  const workspaceStore = useWorkspaceStore();

  const message = ref("");
  const messageType = ref("error");
  const selectingWorkspaceSlug = ref("");
  const inviteAction = ref({
    token: "",
    decision: ""
  });

  const workspaceItems = computed(() => (Array.isArray(workspaceStore.workspaces) ? workspaceStore.workspaces : []));
  const pendingInvites = computed(() =>
    Array.isArray(workspaceStore.pendingInvites) ? workspaceStore.pendingInvites : []
  );

  function workspaceAvatarStyle(workspace) {
    return {
      backgroundColor: coerceWorkspaceColor(workspace?.color)
    };
  }

  async function openWorkspace(workspaceSlug) {
    selectingWorkspaceSlug.value = String(workspaceSlug || "");
    message.value = "";

    try {
      const result = await workspaceStore.selectWorkspace(workspaceSlug);
      const slug = String(result?.workspace?.slug || workspaceSlug || "");
      await navigate({
        to: surfacePaths.value.workspaceHomePath(slug),
        replace: true
      });
    } catch (error) {
      messageType.value = "error";
      message.value = String(error?.message || "Unable to open workspace.");
    } finally {
      selectingWorkspaceSlug.value = "";
    }
  }

  async function acceptInvite(invite) {
    inviteAction.value = {
      token: String(invite?.token || ""),
      decision: "accept"
    };
    message.value = "";

    try {
      const response = await workspaceStore.respondToPendingInvite(invite.token, "accept");
      const slug = String(response?.workspace?.slug || invite.workspaceSlug || "");
      await navigate({
        to: surfacePaths.value.workspaceHomePath(slug),
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
      await workspaceStore.respondToPendingInvite(invite.token, "refuse");
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
      await workspaceStore.refreshBootstrap();
    } catch (error) {
      messageType.value = "error";
      message.value = String(error?.message || "Unable to load workspaces.");
      return;
    }

    if (workspaceStore.hasActiveWorkspace && workspaceStore.activeWorkspaceSlug) {
      await navigate({
        to: surfacePaths.value.workspaceHomePath(workspaceStore.activeWorkspaceSlug),
        replace: true
      });
      return;
    }

    if (workspaceItems.value.length === 1 && pendingInvites.value.length < 1) {
      await openWorkspace(workspaceItems.value[0].slug);
    }
  });

  return {
    presentation: {
      workspaceInitials,
      workspaceAvatarStyle
    },
    feedback: reactive({
      message,
      messageType
    }),
    selection: reactive({
      selectingWorkspaceSlug,
      inviteAction
    }),
    collections: reactive({
      workspaceItems,
      pendingInvites
    }),
    actions: {
      openWorkspace,
      acceptInvite,
      refuseInvite
    }
  };
}
