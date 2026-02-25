function toQueryString(query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    if (value == null) {
      continue;
    }

    const normalized = String(value).trim();
    if (!normalized) {
      continue;
    }

    params.set(key, normalized);
  }

  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

function createApi({ request }) {
  return {
    listFeed(query = {}) {
      return request(`/api/v1/workspace/social/feed${toQueryString(query)}`);
    },
    createPost(payload) {
      return request("/api/v1/workspace/social/posts", {
        method: "POST",
        body: payload
      });
    },
    getPost(postId) {
      const encodedPostId = encodeURIComponent(String(postId || "").trim());
      return request(`/api/v1/workspace/social/posts/${encodedPostId}`);
    },
    updatePost(postId, payload) {
      const encodedPostId = encodeURIComponent(String(postId || "").trim());
      return request(`/api/v1/workspace/social/posts/${encodedPostId}`, {
        method: "PATCH",
        body: payload
      });
    },
    deletePost(postId) {
      const encodedPostId = encodeURIComponent(String(postId || "").trim());
      return request(`/api/v1/workspace/social/posts/${encodedPostId}`, {
        method: "DELETE"
      });
    },
    createComment(postId, payload) {
      const encodedPostId = encodeURIComponent(String(postId || "").trim());
      return request(`/api/v1/workspace/social/posts/${encodedPostId}/comments`, {
        method: "POST",
        body: payload
      });
    },
    deleteComment(commentId) {
      const encodedCommentId = encodeURIComponent(String(commentId || "").trim());
      return request(`/api/v1/workspace/social/comments/${encodedCommentId}`, {
        method: "DELETE"
      });
    },
    requestFollow(payload) {
      return request("/api/v1/workspace/social/follows", {
        method: "POST",
        body: payload
      });
    },
    undoFollow(followId) {
      const encodedFollowId = encodeURIComponent(String(followId || "").trim());
      return request(`/api/v1/workspace/social/follows/${encodedFollowId}`, {
        method: "DELETE"
      });
    },
    searchActors(query = {}) {
      return request(`/api/v1/workspace/social/actors/search${toQueryString(query)}`);
    },
    getActorProfile(actorId) {
      const encodedActorId = encodeURIComponent(String(actorId || "").trim());
      return request(`/api/v1/workspace/social/actors/${encodedActorId}`);
    },
    listNotifications(query = {}) {
      return request(`/api/v1/workspace/social/notifications${toQueryString(query)}`);
    },
    markNotificationsRead(payload = {}) {
      return request("/api/v1/workspace/social/notifications/read", {
        method: "POST",
        body: payload
      });
    },
    listModerationRules(query = {}) {
      return request(`/api/v1/workspace/admin/social/moderation/rules${toQueryString(query)}`);
    },
    createModerationRule(payload = {}) {
      return request("/api/v1/workspace/admin/social/moderation/rules", {
        method: "POST",
        body: payload
      });
    },
    deleteModerationRule(ruleId) {
      const encodedRuleId = encodeURIComponent(String(ruleId || "").trim());
      return request(`/api/v1/workspace/admin/social/moderation/rules/${encodedRuleId}`, {
        method: "DELETE"
      });
    }
  };
}

export { createApi };
