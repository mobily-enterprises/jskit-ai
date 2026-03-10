import {
  isDuplicateEntryError,
  nowDb,
  toIsoString
} from "../common/repositories/repositoryUtils.js";

function mapRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    assistantSystemPromptWorkspace: String(row.assistant_system_prompt_workspace || ""),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function createRepository(knex) {
  if (typeof knex !== "function") {
    throw new TypeError("consoleSettingsRepository requires knex.");
  }

  async function findSingleton(options = {}) {
    const client = options?.trx || knex;
    const row = await client("console_settings").where({ id: 1 }).first();
    return mapRow(row);
  }

  async function ensureSingleton(defaults = {}, options = {}) {
    const client = options?.trx || knex;
    const existing = await findSingleton({ trx: client });
    if (existing) {
      return existing;
    }

    const source = defaults && typeof defaults === "object" ? defaults : {};

    try {
      await client("console_settings").insert({
        id: 1,
        assistant_system_prompt_workspace: String(source.assistantSystemPromptWorkspace || ""),
        created_at: nowDb(),
        updated_at: nowDb()
      });
    } catch (error) {
      if (!isDuplicateEntryError(error)) {
        throw error;
      }
    }

    return findSingleton({ trx: client });
  }

  async function updateSingleton(patch = {}, options = {}) {
    const client = options?.trx || knex;
    const source = patch && typeof patch === "object" ? patch : {};
    const current = await ensureSingleton({}, { trx: client });

    const nextAssistantSystemPromptWorkspace = Object.hasOwn(source, "assistantSystemPromptWorkspace")
      ? String(source.assistantSystemPromptWorkspace || "")
      : String(current?.assistantSystemPromptWorkspace || "");

    await client("console_settings")
      .where({ id: 1 })
      .update({
        assistant_system_prompt_workspace: nextAssistantSystemPromptWorkspace,
        updated_at: nowDb()
      });

    return findSingleton({ trx: client });
  }

  return Object.freeze({
    findSingleton,
    ensureSingleton,
    updateSingleton
  });
}

export { createRepository, mapRow };
