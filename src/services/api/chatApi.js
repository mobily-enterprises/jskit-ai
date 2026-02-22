function buildQueryString(query = {}) {
  const params = new URLSearchParams();
  if (query.cursor) {
    params.set("cursor", String(query.cursor));
  }
  if (query.limit != null) {
    params.set("limit", String(query.limit));
  }

  const value = params.toString();
  return value ? `?${value}` : "";
}

function createApi({ request }) {
  return {
    ensureDm(payload) {
      return request("/api/chat/dm/ensure", {
        method: "POST",
        body: payload
      });
    },
    listInbox(query = {}) {
      return request(`/api/chat/inbox${buildQueryString(query)}`);
    },
    getThread(threadId) {
      const encodedThreadId = encodeURIComponent(String(threadId || "").trim());
      return request(`/api/chat/threads/${encodedThreadId}`);
    },
    listThreadMessages(threadId, query = {}) {
      const encodedThreadId = encodeURIComponent(String(threadId || "").trim());
      return request(`/api/chat/threads/${encodedThreadId}/messages${buildQueryString(query)}`);
    },
    sendThreadMessage(threadId, payload) {
      const encodedThreadId = encodeURIComponent(String(threadId || "").trim());
      return request(`/api/chat/threads/${encodedThreadId}/messages`, {
        method: "POST",
        body: payload
      });
    },
    markThreadRead(threadId, payload) {
      const encodedThreadId = encodeURIComponent(String(threadId || "").trim());
      return request(`/api/chat/threads/${encodedThreadId}/read`, {
        method: "POST",
        body: payload
      });
    }
  };
}

export { createApi };
