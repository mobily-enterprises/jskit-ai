import {
  nowDb,
  toIsoString
} from "../common/repositories/repositoryUtils.js";
import { parsePositiveInteger } from "@jskit-ai/kernel/server/runtime";

function mapSingletonRow(row) {
  if (!row) {
    throw new Error("console_settings singleton row is missing.");
  }

  const ownerUserId = parsePositiveInteger(row.owner_user_id);
  return {
    id: Number(row.id),
    ownerUserId: ownerUserId || null,
    assistantSystemPromptWorkspace: String(row.assistant_system_prompt_workspace || ""),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function createRepository(knex) {
  if (typeof knex !== "function") {
    throw new TypeError("consoleSettingsRepository requires knex.");
  }

  async function readSingleton(client) {
    return client("console_settings").where({ id: 1 }).first();
  }

  async function getSingleton(options = {}) {
    const client = options?.trx || knex;
    return mapSingletonRow(await readSingleton(client));
  }

  async function ensureOwnerUserId(userId, options = {}) {
    const client = options?.trx || knex;
    const candidateOwnerUserId = parsePositiveInteger(userId);
    if (!candidateOwnerUserId) {
      throw new TypeError("consoleSettingsRepository.ensureOwnerUserId requires a positive user id.");
    }

    const current = mapSingletonRow(await readSingleton(client));
    if (current.ownerUserId) {
      return current.ownerUserId;
    }

    await client("console_settings")
      .where({ id: 1 })
      .whereNull("owner_user_id")
      .update({
        owner_user_id: candidateOwnerUserId,
        updated_at: nowDb()
      });

    const reloaded = mapSingletonRow(await readSingleton(client));
    if (!reloaded.ownerUserId) {
      throw new Error("console_settings owner_user_id could not be resolved.");
    }

    return reloaded.ownerUserId;
  }

  async function updateSingleton(patch, options = {}) {
    const client = options?.trx || knex;
    const nextAssistantSystemPromptWorkspace = String(patch.assistantSystemPromptWorkspace || "");

    await client("console_settings")
      .where({ id: 1 })
      .update({
        assistant_system_prompt_workspace: nextAssistantSystemPromptWorkspace,
        updated_at: nowDb()
      });

    return getSingleton({ trx: client });
  }

  return Object.freeze({
    getSingleton,
    ensureOwnerUserId,
    updateSingleton
  });
}

export { createRepository };
