import { randomUUID } from "node:crypto";
import { toWrittenDateTime } from "./repositoryPersistenceUtils.js";

function scopeKey(scope) {
  return JSON.stringify([scope.surfaceId, scope.workspaceId]);
}

function mapTurnRequestRecord(record) {
  return {
    id: record.id,
    token: record.claimToken,
    request: JSON.parse(record.requestJson),
    response: record.responseJson ? JSON.parse(record.responseJson) : null,
    status: record.status
  };
}

/**
 * The receipt of each chat request, on the assistantTurnRequests table: its
 * actor claims and reads it in that actor's user context; the claim that
 * recorded it settles it.
 * @param {object} dependencies
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} dependencies.turnRequests
 * @param {(reason: string) => import("@jskit-ai/resource-runtime/server/types").SystemContext} dependencies.systemContext
 */
function createRepository({ turnRequests, systemContext }) {
  const receiptContext = systemContext("a request receipt is settled by the claim that recorded it, after its actor's request was checked");

  async function find(scope, messageId) {
    const { records } = await turnRequests.query({
      filters: { scopeKey: scopeKey(scope), messageSid: messageId },
      page: { size: 1 }
    }, { context: receiptContext.forUser(scope.actorUserId) });
    return records[0] ? mapTurnRequestRecord(records[0]) : null;
  }

  async function claim(scope, request) {
    const token = randomUUID();
    await turnRequests.createMany([{
      scopeKey: scopeKey(scope),
      messageSid: request.messageId,
      claimToken: token,
      requestJson: JSON.stringify(request)
    }], {
      context: receiptContext.forUser(scope.actorUserId),
      onConflict: { keys: ["userId", "scopeKey", "messageSid"], action: "ignore" }
    });
    const record = await find(scope, request.messageId);
    if (!record) throw new Error("Assistant request could not be recorded.");
    return { ...record, acquired: record.token === token };
  }

  async function update(claimed, response, status = "running") {
    const changed = await turnRequests.patchWhereIds([claimed.id], {
      responseJson: JSON.stringify(response),
      status,
      updatedAt: toWrittenDateTime()
    }, {
      context: receiptContext,
      onlyIf: { claimToken: claimed.token, status: "running" },
      missing: "skip",
      returning: "ids"
    });
    if (!changed.length) throw new Error("Assistant request ownership was lost.");
  }

  return Object.freeze({
    find,
    claim,
    update
  });
}

export { createRepository };
