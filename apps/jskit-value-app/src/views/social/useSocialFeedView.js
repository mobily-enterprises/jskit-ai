import { computed, reactive, ref } from "vue";
import { useNavigate, useRouterState } from "@tanstack/vue-router";
import { mapSocialError } from "@jskit-ai/social-contracts";
import { createSurfacePaths, resolveSurfacePaths } from "../../../shared/surfacePaths.js";
import { api } from "../../platform/http/api/index.js";
import { useWorkspaceStore } from "../../app/state/workspaceStore.js";
import { useSocialView } from "../../modules/social/runtime.js";

const SOCIAL_VISIBILITY_OPTIONS = Object.freeze([
  { title: "Public", value: "public" },
  { title: "Unlisted", value: "unlisted" },
  { title: "Followers", value: "followers" },
  { title: "Direct", value: "direct" }
]);

function normalizeText(value) {
  return String(value || "").trim();
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 0;
  }

  return parsed;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString();
}

function resolveActorName(actor = {}) {
  const displayName = normalizeText(actor.displayName);
  if (displayName) {
    return displayName;
  }

  const username = normalizeText(actor.username);
  if (username) {
    return `@${username}`;
  }

  return "Unknown actor";
}

function canStartLocalDm(actor) {
  return Boolean(actor?.isLocal && normalizeText(actor?.publicChatId));
}

function buildAdminChatTarget({ workspaceSlug, threadId = 0, dmPublicChatId = "" } = {}) {
  const adminSurfacePaths = createSurfacePaths("admin");
  const path = adminSurfacePaths.workspacePath(workspaceSlug, "/chat");
  const searchParams = new URLSearchParams();
  if (threadId > 0) {
    searchParams.set("threadId", String(threadId));
  }
  if (normalizeText(dmPublicChatId)) {
    searchParams.set("dmPublicChatId", normalizeText(dmPublicChatId).toLowerCase());
  }

  const queryString = searchParams.toString();
  return {
    path,
    url: queryString ? `${path}?${queryString}` : path
  };
}

export function useSocialFeedView() {
  const navigate = useNavigate();
  const workspaceStore = useWorkspaceStore();
  const currentPath = useRouterState({
    select: (state) => state.location.pathname
  });
  const currentSurface = computed(() => {
    const pathname = normalizeText(currentPath.value);
    if (pathname.startsWith("/admin/")) {
      return "admin";
    }
    if (pathname.startsWith("/console/")) {
      return "console";
    }

    return resolveSurfacePaths(pathname).surface;
  });
  const socialView = useSocialView({
    feedLimit: 20,
    notificationsLimit: 30,
    actorSearchLimit: 20,
    includeNotifications: true
  });

  const actionError = ref("");
  const actionNotice = ref("");
  const followHandle = ref("");

  const canWrite = computed(() => workspaceStore.can("social.write"));
  const canModerate = computed(() => workspaceStore.can("social.moderate"));
  const canUseChat = computed(() => workspaceStore.can("chat.read") && workspaceStore.can("chat.write"));
  const feedEmpty = computed(() => !socialView.state.feedQuery.isFetching.value && socialView.state.feedItems.value.length < 1);

  const isBusy = computed(
    () =>
      socialView.state.createPostMutation.isPending.value ||
      socialView.state.createCommentMutation.isPending.value ||
      socialView.state.requestFollowMutation.isPending.value ||
      socialView.state.markNotificationsReadMutation.isPending.value
  );

  function clearActionFeedback() {
    actionError.value = "";
    actionNotice.value = "";
  }

  async function submitPost() {
    clearActionFeedback();
    try {
      await socialView.actions.submitPost();
    } catch (error) {
      actionError.value = mapSocialError(error, "Unable to publish post.").message;
    }
  }

  async function submitComment(postId) {
    clearActionFeedback();
    try {
      await socialView.actions.submitComment(postId);
    } catch (error) {
      actionError.value = mapSocialError(error, "Unable to publish comment.").message;
    }
  }

  async function deletePost(postId) {
    clearActionFeedback();
    try {
      await socialView.state.deletePostMutation.mutateAsync({
        postId
      });
    } catch (error) {
      actionError.value = mapSocialError(error, "Unable to delete post.").message;
    }
  }

  async function deleteComment(commentId) {
    clearActionFeedback();
    try {
      await socialView.state.deleteCommentMutation.mutateAsync({
        commentId
      });
    } catch (error) {
      actionError.value = mapSocialError(error, "Unable to delete comment.").message;
    }
  }

  async function followByHandle() {
    clearActionFeedback();
    const handle = normalizeText(followHandle.value);
    if (!handle) {
      return;
    }

    try {
      await socialView.state.requestFollowMutation.mutateAsync({
        handle
      });
      followHandle.value = "";
      actionNotice.value = `Follow request sent for ${handle}.`;
    } catch (error) {
      actionError.value = mapSocialError(error, "Unable to request follow.").message;
    }
  }

  async function followActor(actor) {
    clearActionFeedback();
    if (!actor) {
      return;
    }

    try {
      if (actor.id) {
        await socialView.state.requestFollowMutation.mutateAsync({
          actorId: actor.id
        });
      } else if (actor.actorUri) {
        await socialView.state.requestFollowMutation.mutateAsync({
          actorUri: actor.actorUri
        });
      } else if (actor.username) {
        await socialView.state.requestFollowMutation.mutateAsync({
          handle: actor.username
        });
      } else {
        throw new Error("Missing actor selector.");
      }

      actionNotice.value = `Following ${resolveActorName(actor)}.`;
    } catch (error) {
      actionError.value = mapSocialError(error, "Unable to request follow.").message;
    }
  }

  async function startDmForActor(actor) {
    clearActionFeedback();
    if (!canUseChat.value) {
      actionError.value = "You do not have permission to start direct messages.";
      return;
    }

    if (!canStartLocalDm(actor)) {
      actionError.value = "Direct messages are available only for local users.";
      return;
    }

    try {
      const targetPublicChatId = normalizeText(actor.publicChatId).toLowerCase();
      const response = await api.chat.ensureDm({
        targetPublicChatId
      });
      const threadId = toPositiveInteger(response?.thread?.id);
      const workspaceSlug = normalizeText(workspaceStore.activeWorkspaceSlug);
      if (!workspaceSlug) {
        throw new Error("Workspace context unavailable.");
      }

      const target = buildAdminChatTarget({
        workspaceSlug,
        threadId,
        dmPublicChatId: targetPublicChatId
      });

      if (currentSurface.value === "admin") {
        await navigate({
          to: target.path,
          search: {
            threadId: threadId > 0 ? String(threadId) : undefined,
            dmPublicChatId: targetPublicChatId
          }
        });
      } else if (typeof window !== "undefined") {
        window.location.assign(target.url);
      }
    } catch (error) {
      actionError.value = mapSocialError(error, "Unable to open direct message.").message;
    }
  }

  async function goToModeration() {
    if (!canModerate.value) {
      return;
    }

    const workspaceSlug = normalizeText(workspaceStore.activeWorkspaceSlug);
    if (!workspaceSlug) {
      return;
    }

    const adminSurfacePaths = createSurfacePaths("admin");
    const targetPath = adminSurfacePaths.workspacePath(workspaceSlug, "/social/moderation");
    if (currentSurface.value === "admin") {
      await navigate({
        to: targetPath
      });
      return;
    }

    if (typeof window !== "undefined") {
      window.location.assign(targetPath);
    }
  }

  async function markAllNotificationsRead() {
    clearActionFeedback();
    try {
      await socialView.actions.markAllNotificationsRead();
    } catch (error) {
      actionError.value = mapSocialError(error, "Unable to mark notifications as read.").message;
    }
  }

  return {
    meta: {
      visibilityOptions: SOCIAL_VISIBILITY_OPTIONS,
      formatDateTime,
      resolveActorName
    },
    state: reactive({
      ...socialView.state,
      actionError,
      actionNotice,
      followHandle,
      canWrite,
      canModerate,
      canUseChat,
      isBusy,
      feedEmpty
    }),
    actions: {
      submitPost,
      submitComment,
      deletePost,
      deleteComment,
      followByHandle,
      followActor,
      startDmForActor,
      markAllNotificationsRead,
      goToModeration,
      canStartLocalDm,
      async refreshAll() {
        clearActionFeedback();
        await socialView.actions.refreshAll();
      }
    }
  };
}
