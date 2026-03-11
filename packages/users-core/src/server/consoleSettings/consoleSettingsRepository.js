import {
  nowDb,
  toIsoString
} from "../common/repositories/repositoryUtils.js";

function createRepository(knex) {
  async function getSingleton(options = {}) {
    const client = options?.trx || knex;
    const row = await client("console_settings").where({ id: 1 }).first();
    if (!row) {
      throw new Error("console_settings singleton row is missing.");
    }

    return {
      id: Number(row.id),
      assistantSystemPromptWorkspace: String(row.assistant_system_prompt_workspace || ""),
      createdAt: toIsoString(row.created_at),
      updatedAt: toIsoString(row.updated_at)
    };
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
    updateSingleton
  });
}

export { createRepository };
