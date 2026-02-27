function createApi({ request }) {
  return {
    listAiTranscripts(query = {}) {
      const params = new URLSearchParams();
      if (query.page != null) {
        params.set("page", String(query.page));
      }
      if (query.pageSize != null) {
        params.set("pageSize", String(query.pageSize));
      }
      if (query.workspaceId != null) {
        params.set("workspaceId", String(query.workspaceId));
      }
      if (query.from) {
        params.set("from", String(query.from));
      }
      if (query.to) {
        params.set("to", String(query.to));
      }
      if (query.status) {
        params.set("status", String(query.status));
      }
      const queryString = params.toString();
      return request(`/api/v1/console/ai/transcripts${queryString ? `?${queryString}` : ""}`);
    },
    getAiTranscriptMessages(conversationId, query = {}) {
      const encodedConversationId = encodeURIComponent(String(conversationId || "").trim());
      const params = new URLSearchParams();
      if (query.page != null) {
        params.set("page", String(query.page));
      }
      if (query.pageSize != null) {
        params.set("pageSize", String(query.pageSize));
      }
      const queryString = params.toString();
      return request(
        `/api/v1/console/ai/transcripts/${encodedConversationId}/messages${queryString ? `?${queryString}` : ""}`
      );
    },
    exportAiTranscripts(query = {}) {
      const params = new URLSearchParams();
      if (query.workspaceId != null) {
        params.set("workspaceId", String(query.workspaceId));
      }
      if (query.conversationId != null) {
        params.set("conversationId", String(query.conversationId));
      }
      if (query.role) {
        params.set("role", String(query.role));
      }
      if (query.from) {
        params.set("from", String(query.from));
      }
      if (query.to) {
        params.set("to", String(query.to));
      }
      if (query.limit != null) {
        params.set("limit", String(query.limit));
      }
      if (query.format) {
        params.set("format", String(query.format));
      }
      const queryString = params.toString();
      return request(`/api/v1/console/ai/transcripts/export${queryString ? `?${queryString}` : ""}`);
    }
  };
}

export { createApi };
