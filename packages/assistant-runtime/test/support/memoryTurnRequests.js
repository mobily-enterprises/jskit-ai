// A test double for lifecycle tests; runtime admission uses the database repository.
export function createMemoryTurnRequests() {
  const records = new Map();
  const key = (scope, messageId) => JSON.stringify([scope, messageId]);
  return {
    async find(scope, messageId) { return records.get(key(scope, messageId)) || null; },
    async claim(scope, request) {
      const id = key(scope, request.messageId);
      const existing = records.get(id);
      if (existing) return { ...existing, acquired: false };
      const record = { id, request: JSON.parse(JSON.stringify(request)), status: "running", response: null };
      records.set(id, record);
      return { ...record, acquired: true };
    },
    async update(claim, response, status = "running") {
      Object.assign(records.get(claim.id), { response: structuredClone(response), status });
    }
  };
}
