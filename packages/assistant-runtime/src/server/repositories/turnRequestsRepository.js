import { randomUUID } from "node:crypto";
import { assistantRuntimeConfig } from "../../shared/assistantRuntimeConfig.js";

function createRepository(knex) {
  const table = assistantRuntimeConfig.turnRequestsTable;

  function key(scope, messageId) {
    return { actor_user_id: scope.actorUserId, scope_key: JSON.stringify([scope.surfaceId, scope.workspaceId]), message_sid: messageId };
  }

  async function find(scope, messageId) {
    const row = await knex(table).where(key(scope, messageId)).first();
    return row ? { id: row.id, token: row.claim_token, request: JSON.parse(row.request_json),
      response: row.response_json ? JSON.parse(row.response_json) : null, status: row.status } : null;
  }

  async function claim(scope, request) {
    const token = randomUUID();
    await knex(table).insert({ ...key(scope, request.messageId), claim_token: token, request_json: JSON.stringify(request) })
      .onConflict(["actor_user_id", "scope_key", "message_sid"]).ignore();
    const record = await find(scope, request.messageId);
    if (!record) throw new Error("Assistant request could not be recorded.");
    return { ...record, acquired: record.token === token };
  }

  async function update(claim, response, status = "running") {
    const changed = await knex(table).where({ id: claim.id, claim_token: claim.token, status: "running" })
      .update({ response_json: JSON.stringify(response), status, updated_at: new Date() });
    if (!changed) throw new Error("Assistant request ownership was lost.");
  }

  return Object.freeze({ find, claim, update });
}

export { createRepository };
