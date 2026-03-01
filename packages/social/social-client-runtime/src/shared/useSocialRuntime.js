import { computed, reactive, ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { toPositiveInteger } from "@jskit-ai/runtime-env-core/integers";
import { normalizeText } from "@jskit-ai/runtime-env-core/text";
import {
  defaultUseAuthGuard,
  createDefaultUseWorkspaceStore,
  createDefaultUseQueryErrorMessage
} from "@jskit-ai/runtime-env-core/clientRuntimeDefaults";
import {
  socialActorSearchQueryKey,
  socialFeedQueryKey,
  socialNotificationsQueryKey,
  socialRootQueryKey,
  socialScopeQueryKey,
  mapSocialError
} from "@jskit-ai/social-contracts";

const DEFAULT_USE_AUTH_GUARD = defaultUseAuthGuard;
const DEFAULT_USE_QUERY_ERROR_MESSAGE = createDefaultUseQueryErrorMessage({
  computed,
  resolveMessage(error) {
    return mapSocialError(error).message;
  },
  fallbackMessage: "Unable to complete social request."
});
const DEFAULT_USE_WORKSPACE_STORE = createDefaultUseWorkspaceStore({
  can() {
    return false;
  }
});

function createSocialRuntime({
  api,
  useAuthGuard = DEFAULT_USE_AUTH_GUARD,
  useQueryErrorMessage = DEFAULT_USE_QUERY_ERROR_MESSAGE,
  useWorkspaceStore = DEFAULT_USE_WORKSPACE_STORE
} = {}) {
  if (!api || !api.social) {
    throw new Error("api.social is required.");
  }

  function useSocialView({
    feedLimit = 20,
    notificationsLimit = 30,
    actorSearchLimit = 20,
    includeNotifications = true
  } = {}) {
    const authGuard = useAuthGuard();
    const workspaceStore = useWorkspaceStore();
    const queryClient = useQueryClient();

    const composerText = ref("");
    const composerVisibility = ref("public");
    const commentDrafts = reactive({});
    const actorSearchText = ref("");
    const notificationsUnreadOnly = ref(false);

    const workspaceSlug = computed(() => normalizeText(workspaceStore.activeWorkspaceSlug || ""));
    const resolvedFeedLimit = computed(() => toPositiveInteger(feedLimit, 20));
    const resolvedNotificationsLimit = computed(() => toPositiveInteger(notificationsLimit, 30));
    const resolvedActorSearchLimit = computed(() => toPositiveInteger(actorSearchLimit, 20));

    const feedQuery = useQuery({
      queryKey: computed(() =>
        socialFeedQueryKey(workspaceSlug.value, {
          limit: resolvedFeedLimit.value
        })
      ),
      enabled: computed(() => Boolean(workspaceSlug.value)),
      queryFn: async () => {
        try {
          return await api.social.listFeed({
            limit: resolvedFeedLimit.value
          });
        } catch (error) {
          authGuard.handleUnauthorizedError(error);
          throw error;
        }
      },
      staleTime: 10_000
    });

    const notificationsQuery = useQuery({
      queryKey: computed(() =>
        socialNotificationsQueryKey(workspaceSlug.value, {
          limit: resolvedNotificationsLimit.value,
          unreadOnly: notificationsUnreadOnly.value
        })
      ),
      enabled: computed(() => Boolean(workspaceSlug.value) && includeNotifications),
      queryFn: async () => {
        try {
          return await api.social.listNotifications({
            limit: resolvedNotificationsLimit.value,
            unreadOnly: notificationsUnreadOnly.value
          });
        } catch (error) {
          authGuard.handleUnauthorizedError(error);
          throw error;
        }
      },
      staleTime: 5_000
    });

    const actorSearchQuery = useQuery({
      queryKey: computed(() =>
        socialActorSearchQueryKey(workspaceSlug.value, {
          query: actorSearchText.value,
          limit: resolvedActorSearchLimit.value
        })
      ),
      enabled: computed(() => Boolean(workspaceSlug.value) && normalizeText(actorSearchText.value).length > 1),
      queryFn: async () => {
        try {
          return await api.social.searchActors({
            q: normalizeText(actorSearchText.value),
            limit: resolvedActorSearchLimit.value
          });
        } catch (error) {
          authGuard.handleUnauthorizedError(error);
          throw error;
        }
      },
      staleTime: 30_000
    });

    async function invalidateScopeQueries() {
      await queryClient.invalidateQueries({
        queryKey: socialScopeQueryKey(workspaceSlug.value)
      });
    }

    const createPostMutation = useMutation({
      mutationFn: async ({ contentText, visibility = "public" } = {}) => {
        return api.social.createPost({
          contentText: normalizeText(contentText),
          visibility: normalizeText(visibility) || "public"
        });
      },
      onSuccess: invalidateScopeQueries,
      onError(error) {
        authGuard.handleUnauthorizedError(error);
      }
    });

    const deletePostMutation = useMutation({
      mutationFn: async ({ postId } = {}) => api.social.deletePost(postId),
      onSuccess: invalidateScopeQueries,
      onError(error) {
        authGuard.handleUnauthorizedError(error);
      }
    });

    const createCommentMutation = useMutation({
      mutationFn: async ({ postId, contentText } = {}) => {
        return api.social.createComment(postId, {
          contentText: normalizeText(contentText)
        });
      },
      onSuccess: invalidateScopeQueries,
      onError(error) {
        authGuard.handleUnauthorizedError(error);
      }
    });

    const deleteCommentMutation = useMutation({
      mutationFn: async ({ commentId } = {}) => api.social.deleteComment(commentId),
      onSuccess: invalidateScopeQueries,
      onError(error) {
        authGuard.handleUnauthorizedError(error);
      }
    });

    const requestFollowMutation = useMutation({
      mutationFn: async (payload = {}) => api.social.requestFollow(payload),
      onSuccess: invalidateScopeQueries,
      onError(error) {
        authGuard.handleUnauthorizedError(error);
      }
    });

    const undoFollowMutation = useMutation({
      mutationFn: async ({ followId } = {}) => api.social.undoFollow(followId),
      onSuccess: invalidateScopeQueries,
      onError(error) {
        authGuard.handleUnauthorizedError(error);
      }
    });

    const markNotificationsReadMutation = useMutation({
      mutationFn: async ({ notificationIds = [] } = {}) => api.social.markNotificationsRead({ notificationIds }),
      onSuccess: invalidateScopeQueries,
      onError(error) {
        authGuard.handleUnauthorizedError(error);
      }
    });

    const feedItems = computed(() => {
      const source = Array.isArray(feedQuery.data.value?.items) ? feedQuery.data.value.items : [];
      return source;
    });

    const notifications = computed(() => {
      const source = Array.isArray(notificationsQuery.data.value?.items) ? notificationsQuery.data.value.items : [];
      return source;
    });

    const actorResults = computed(() => {
      const source = Array.isArray(actorSearchQuery.data.value?.items) ? actorSearchQuery.data.value.items : [];
      return source;
    });

    async function submitPost() {
      const contentText = normalizeText(composerText.value);
      if (!contentText) {
        return null;
      }

      const response = await createPostMutation.mutateAsync({
        contentText,
        visibility: composerVisibility.value
      });
      composerText.value = "";
      return response;
    }

    async function submitComment(postId) {
      const key = String(postId || "").trim();
      const contentText = normalizeText(commentDrafts[key]);
      if (!key || !contentText) {
        return null;
      }

      const response = await createCommentMutation.mutateAsync({
        postId,
        contentText
      });
      commentDrafts[key] = "";
      return response;
    }

    async function markAllNotificationsRead() {
      const ids = notifications.value.map((entry) => Number(entry?.id)).filter((value) => Number.isInteger(value) && value > 0);
      if (ids.length < 1) {
        return {
          updated: true,
          notificationIds: []
        };
      }

      return markNotificationsReadMutation.mutateAsync({
        notificationIds: ids
      });
    }

    const errorMessage = useQueryErrorMessage({
      error: computed(() => feedQuery.error.value || createPostMutation.error.value || createCommentMutation.error.value)
    });

    return {
      meta: {
        workspaceSlug
      },
      state: {
        composerText,
        composerVisibility,
        commentDrafts,
        actorSearchText,
        notificationsUnreadOnly,
        feedQuery,
        notificationsQuery,
        actorSearchQuery,
        feedItems,
        notifications,
        actorResults,
        createPostMutation,
        deletePostMutation,
        createCommentMutation,
        deleteCommentMutation,
        requestFollowMutation,
        undoFollowMutation,
        markNotificationsReadMutation,
        errorMessage
      },
      actions: {
        submitPost,
        submitComment,
        markAllNotificationsRead,
        async refreshAll() {
          await queryClient.invalidateQueries({ queryKey: socialRootQueryKey() });
        }
      }
    };
  }

  return {
    useSocialView
  };
}

const socialRuntimeTestables = Object.freeze({
  normalizeText,
  toPositiveInteger
});

export { createSocialRuntime, socialRuntimeTestables };
