function buildQueryString(query = {}) {
  const params = new URLSearchParams();
  if (query.q) {
    params.set("q", String(query.q));
  }
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
    listDmCandidates(query = {}) {
      return request(`/api/chat/dm/candidates${buildQueryString(query)}`);
    },
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
    reserveThreadAttachment(threadId, payload) {
      const encodedThreadId = encodeURIComponent(String(threadId || "").trim());
      return request(`/api/chat/threads/${encodedThreadId}/attachments/reserve`, {
        method: "POST",
        body: payload
      });
    },
    uploadThreadAttachment(threadId, formData) {
      const encodedThreadId = encodeURIComponent(String(threadId || "").trim());
      return request(`/api/chat/threads/${encodedThreadId}/attachments/upload`, {
        method: "POST",
        body: formData
      });
    },
    deleteThreadAttachment(threadId, attachmentId) {
      const encodedThreadId = encodeURIComponent(String(threadId || "").trim());
      const encodedAttachmentId = encodeURIComponent(String(attachmentId || "").trim());
      return request(`/api/chat/threads/${encodedThreadId}/attachments/${encodedAttachmentId}`, {
        method: "DELETE"
      });
    },
    markThreadRead(threadId, payload) {
      const encodedThreadId = encodeURIComponent(String(threadId || "").trim());
      return request(`/api/chat/threads/${encodedThreadId}/read`, {
        method: "POST",
        body: payload
      });
    },
    emitThreadTyping(threadId) {
      const encodedThreadId = encodeURIComponent(String(threadId || "").trim());
      return request(`/api/chat/threads/${encodedThreadId}/typing`, {
        method: "POST"
      });
    }
  };
}

export { createApi };
